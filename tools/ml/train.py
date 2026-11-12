"""Обучение нейросетей буя: события, живость природы, отпечатки катеров.

    cd tools/ml && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python train.py                     # синтетические данные, ~2 минуты на 4 ядрах
    .venv/bin/python train.py --data ~/recordings # плюс настоящие записи (см. ниже)

Настоящие записи (WAV, любая частота; длинные режутся на куски по 4 с):
    recordings/background/*.wav   ночь без угроз: ветер, вода, лягушки, птицы, самолёты
    recordings/motor/*.wav        моторы лодок
    recordings/shot/*.wav         выстрелы
    recordings/voice/*.wav        голоса людей, разговор, крики, «пф» и «бах» ртом — не тревога
    recordings/vessels/<катер>/*.wav   несколько записей одного катера — для отпечатков
Лучше всего — записи того же гидрофона, что стоит на буе, под водой.

Результат — api/app/audio/model.npz (веса и метрики); API подхватывает его при запуске.
Проверка честная: события — на клипах, которых сеть не видела; отпечатки — на катерах,
которых не было в обучении (так и будет в жизни: браконьер приходит со своим мотором).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from sklearn.metrics import confusion_matrix, mean_absolute_error, r2_score, roc_auc_score
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "api"))
from app.audio import dsp, synth  # noqa: E402
from app.audio.model import pack  # noqa: E402

EVENTS = list(synth.EVENTS)
OUT = ROOT / "api" / "app" / "audio" / "model.npz"


# ---------- данные ----------
def event_item(args):
    """Клип для обучения событий. Среда: 70 % — гидрофон под водой (буй), 30 % — воздух (проверка микрофоном).
    Треть моторов звучит не весь клип; у части моторов в лодке разговаривают; треть голосов — «выстрел ртом»."""
    seed, event = args
    r = np.random.default_rng(seed)
    rp = np.random.default_rng(seed ^ 0x5EED)
    medium = "water" if rp.random() < 0.7 else "air"
    seg, voices, imitation = None, False, None
    if event == "motor":
        if rp.random() < 0.35:
            L = float(rp.uniform(0.45, 0.95))
            seg = (float(rp.uniform(0, 1 - L)), L, float(rp.uniform(0.15, 1.2)))
        voices = bool(rp.random() < 0.15)
    if event == "voice":
        imitation = bool(rp.random() < 0.4)
    x, m = synth.scene(r, event, segment=seg, medium=medium, voices=voices, imitation=imitation)
    kind = f"{medium}:" + ("imitation" if imitation else event)
    return dsp.event_features(x), EVENTS.index(event), m["activity"], m.get("snr_db", np.nan), kind


def vessel_item(args):
    seed, vseed = args[:2]
    medium = args[2] if len(args) > 2 else ("water" if np.random.default_rng(seed ^ 0xB0A7).random() < 0.8 else "air")
    snr = args[3] if len(args) > 3 else None
    r = np.random.default_rng(seed)
    x, _ = synth.scene(r, "motor", v=synth.vessel(vseed), snr_db=float(r.uniform(3, 25)) if snr is None else snr, medium=medium)
    return dsp.vessel_features(x), vseed


def wav_windows(path: Path) -> list[np.ndarray]:
    x = dsp.read_wav(path.read_bytes()) if path.stat().st_size < 50_000_000 else None
    if x is None:
        return []
    n = synth.N
    return [x[i:i + n] for i in range(0, max(1, len(x) - n + 1), n)] if len(x) >= n else [np.pad(x, (0, n - len(x)))]


def real_data(root: Path):
    ev, ves = [], []
    for k, name in enumerate(EVENTS):
        for p in sorted((root / name).glob("*.wav")):
            for w in wav_windows(p):
                ev.append((dsp.event_features(w), k))
    for d in sorted((root / "vessels").glob("*")):
        for p in sorted(d.glob("*.wav")):
            for w in wav_windows(p):
                ves.append((dsp.vessel_features(w), f"real:{d.name}"))
    return ev, ves


# ---------- метрики отпечатков ----------
def verification(emb: np.ndarray, ids: np.ndarray):
    S = emb @ emb.T
    iu = np.triu_indices(len(ids), 1)
    same = (ids[:, None] == ids[None, :])[iu]
    s = S[iu]
    auc = roc_auc_score(same, s)
    thr = float(np.quantile(s[~same], 0.99))                 # не больше 1 % ложных «тот же катер»
    tpr = float((s[same] >= thr).mean())
    grid = np.linspace(s.min(), s.max(), 400)
    far = np.array([(s[~same] >= g).mean() for g in grid])
    frr = np.array([(s[same] < g).mean() for g in grid])
    i = int(np.argmin(np.abs(far - frr)))
    return {"auc": round(auc, 4), "eer": round(float((far[i] + frr[i]) / 2), 4), "thr_far1": round(thr, 4), "tpr_at_far1": round(tpr, 4),
            "same_mean": round(float(s[same].mean()), 3), "diff_mean": round(float(s[~same].mean()), 3)}


def znorm(T: np.ndarray, cohort: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Для каждого образа — насколько на него похожи случайные чужие катера (среднее и разброс)."""
    S = T @ cohort.T
    return S.mean(1), S.std(1) + 1e-6


def template_check(enr: np.ndarray, eid: np.ndarray, emb: np.ndarray, ids: np.ndarray, cohort: np.ndarray, far: float = 0.01) -> dict:
    """Так, как работает архив буёв: образ катера — среднее по 3 чистым проходам под водой; каждый новый
    проход под водой (любая громкость) сверяется со всеми образами. Порог — чтобы чужой катер
    выдавался за архивный не чаще far на одну сверку."""
    uniq = np.unique(eid)
    T = []
    for u in uniq:
        t = enr[eid == u].mean(0)
        T.append(t / np.linalg.norm(t))
    T = np.array(T)
    mu, sd = znorm(T, cohort)
    gen, imp = [], []
    for k, u in enumerate(uniq):
        for x in emb[ids == u]:
            z = (T @ x - mu) / sd                          # сходство в «разбросах чужих» для каждого образа
            gen.append(z[k])
            imp.extend(np.delete(z, k))
    gen, imp = np.array(gen), np.array(imp)
    thr = float(np.quantile(imp, 1 - far))
    return {"thr": round(thr, 4), "tpr": round(float((gen >= thr).mean()), 4), "far": far}


def identification(emb: np.ndarray, ids: np.ndarray, enroll: int = 3) -> float:
    """Катер записан enroll раз (архив), остальные проходы узнаём среди всех катеров архива."""
    uniq = np.unique(ids)
    templ, tests = [], []
    for u in uniq:
        e = emb[ids == u]
        t = e[:enroll].mean(0)
        templ.append(t / np.linalg.norm(t))
        tests += [(x, len(templ) - 1) for x in e[enroll:]]
    T = np.array(templ)
    ok = sum(int(np.argmax(T @ x) == k) for x, k in tests)
    return round(ok / len(tests), 4)


# ---------- калибровка порогов ----------
def calibrate(path: Path, n_bg: int, n_ev: int, jobs: int, seed: int) -> dict:
    """Пороги по отдельному большому набору: фон (с самолётами, всплесками, вёслами, громом), моторы, выстрелы.

    Мотор: тревога, если два клипа подряд выше порога «пары» (катер слышно дольше одного клипа,
    случайный гул — нет); ложных на клип фона ≤ 1 %, на пару ≈ 0,01 %. Выстрел — одиночный звук:
    его порог строже (≤ 0,1 % ложных на клип фона).
    """
    from app.audio.model import load
    load.cache_clear()
    m = load(str(path))
    rs = np.random.default_rng(seed + 1)
    jb = [(int(rs.integers(1 << 31)), ev) for ev, k in (("background", n_bg), ("voice", n_bg // 3), ("motor", n_ev), ("shot", n_ev))
          for _ in range(k)]
    with Pool(jobs) as pool:
        items = pool.map(event_item, jb, chunksize=16)
    F = np.array([t[0] for t in items]); y = np.array([t[1] for t in items]); snr = np.array([t[3] for t in items])
    kinds = np.array([t[4] for t in items])
    P = m.events.forward(F)
    bg = (y == 0) | (y == 3)                     # не угроза: фон и голоса людей
    imit = np.char.endswith(kinds.astype(str), "imitation")
    water = np.char.startswith(kinds.astype(str), "water")
    t_motor = float(max(0.5, np.quantile(P[bg, 1], 0.99)))
    t_shot = float(max(0.5, np.quantile(P[bg, 2], 0.999)))
    fa_motor_clip = float((P[bg, 1] >= t_motor).mean())
    fa_shot_clip = float((P[bg, 2] >= t_shot).mean())
    fa_imit = float((P[imit, 2] >= t_shot).mean()) if imit.any() else 0.0
    voice_seen = float((P[y == 3].argmax(1) == 3).mean())
    mot, sh = y == 1, y == 2
    rec_m = float(((P[:, 1] >= t_motor) & (P.argmax(1) == 1))[mot].mean())
    rec_s = float(((P[:, 2] >= t_shot) & (P.argmax(1) == 2))[sh].mean())
    by_snr = {}
    for name, lo, hi in (("< 3 дБ", -99, 3), ("3–10 дБ", 3, 10), ("> 10 дБ", 10, 99)):
        k = mot & (snr >= lo) & (snr < hi)
        if k.any():
            by_snr[name] = round(float((P[k, 1] >= t_motor).mean()), 4)
    rec_sw = float((P[sh & water, 2] >= t_shot).mean()) if (sh & water).any() else 0.0
    res = {"thresholds": {"motor": round(t_motor, 4), "shot": round(t_shot, 4)},
           "calibration": {"background_clips": int(bg.sum()), "event_clips": int((~bg).sum()),
                           "false_shot_on_mouth_imitation": round(fa_imit, 4), "mouth_imitations": int(imit.sum()),
                           "voice_recognised": round(voice_seen, 4), "shot_recall_underwater": round(rec_sw, 4),
                           "false_motor_per_clip": round(fa_motor_clip, 5), "false_motor_two_in_row": round(fa_motor_clip ** 2, 6),
                           "false_shot_per_clip": round(fa_shot_clip, 5), "motor_recall_per_clip": round(rec_m, 4),
                           "motor_recall_by_snr": by_snr, "shot_recall": round(rec_s, 4)}}
    print(f"калибровка на {int(bg.sum())} клипах фона: мотор — порог {t_motor:.3f} (ложных {fa_motor_clip:.3%} на клип, "
          f"два подряд ≈ {fa_motor_clip ** 2:.4%}), ловим {rec_m:.1%} клипов с мотором {by_snr}; "
          f"выстрел — порог {t_shot:.3f} (ложных {fa_shot_clip:.3%}), ловим {rec_s:.1%}, под водой {rec_sw:.1%}; "
          f"«выстрел ртом» за выстрел — {fa_imit:.2%} из {int(imit.sum())}; голоса узнаны в {voice_seen:.1%}")
    return res


def save_calibration(path: Path, cal: dict) -> None:
    with np.load(path, allow_pickle=False) as z:
        arrays = {k: z[k] for k in z.files}
    meta = json.loads(str(arrays["meta"]))
    meta["thresholds"].update(cal["thresholds"])
    meta["metrics"]["calibration"] = cal["calibration"]
    arrays["meta"] = np.array(json.dumps(meta, ensure_ascii=False))
    np.savez_compressed(path, **arrays)


def train_vessels(a, rs, update: Path | None, t0: float, real_ves=None) -> dict:
    """Сеть отпечатков катеров: учится различать катера, отпечаток — её последний скрытый слой.
    update — путь к готовой модели: заменить в ней только эту сеть и её метрики."""
    real_ves = real_ves or []
    t1 = time.time()
    train_v = [1000 + i for i in range(a.vessels)]
    held_v = [5000 + i for i in range(a.held_out)]
    vj = [(int(rs.integers(1 << 31)), v) for v in train_v for _ in range(a.clips)]
    hj = [(int(rs.integers(1 << 31)), v) for v in held_v for _ in range(a.clips)]
    with Pool(a.jobs) as pool:
        vtr = pool.map(vessel_item, vj, chunksize=16)
        vte = pool.map(vessel_item, hj, chunksize=16)
    V = np.array([t[0] for t in vtr]); vid = np.array([str(t[1]) for t in vtr])
    if real_ves:
        V = np.vstack([V, [f for f, _ in real_ves]]); vid = np.concatenate([vid, [i for _, i in real_ves]])
    sc_v = StandardScaler().fit(V)
    v_net = MLPClassifier(hidden_layer_sizes=(128, 32), alpha=3e-3, max_iter=500, early_stopping=True,
                          n_iter_no_change=25, random_state=a.seed).fit(sc_v.transform(V), vid)
    print(f"отпечатки: {len(V)} проходов {len(set(vid))} катеров — {time.time() - t1:.0f} с")

    from app.audio.model import MLP
    vm = MLP(sc_v.mean_, sc_v.scale_, list(v_net.coefs_), list(v_net.intercepts_), "softmax")
    vm.center = vm._hidden(sc_v.inverse_transform(sc_v.transform(V)))[-1].mean(0)      # общий центр отпечатков
    Ht = np.array([t[0] for t in vte]); hid = np.array([t[1] for t in vte])
    emb = vm.embed(Ht)
    ver = verification(emb, hid)
    ident = identification(emb, hid)
    # архив буя: 3 чистых прохода под водой — образ; проверочные проходы под водой с любой громкостью
    ej = [(int(rs.integers(1 << 31)), v, "water", 18.0) for v in held_v for _ in range(3)]
    pj = [(int(rs.integers(1 << 31)), v, "water", float(g)) for v in held_v for g in np.linspace(3, 22, a.clips)]
    # когорта: случайные чужие катера под водой — по ней у каждого образа свой порог (Z-норма)
    cj = [(int(rs.integers(1 << 31)), 900_000 + i, "water", float(g)) for i, g in enumerate(np.tile(np.linspace(3, 22, 8), 40))]
    with Pool(a.jobs) as pool:
        en = pool.map(vessel_item, ej, chunksize=8)
        pr = pool.map(vessel_item, pj, chunksize=8)
        co = pool.map(vessel_item, cj, chunksize=8)
    cohort = vm.embed(np.array([t[0] for t in co]))
    tc = template_check(vm.embed(np.array([t[0] for t in en])), np.array([t[1] for t in en]),
                        vm.embed(np.array([t[0] for t in pr])), np.array([t[1] for t in pr]), cohort)
    ver["tpr_template_far1"] = tc["tpr"]                 # так узнаёт архив под водой при ≤ 1 % чужих на сверку
    print(f"архив под водой: образ из 3 проходов против прохода, Z-норма по {len(cohort)} чужим — порог z {tc['thr']} "
          f"(чужой за архивный ≤ 1 % на сверку), узнаём {tc['tpr'] * 100:.0f} %")
    print(f"отпечатки на новых катерах ({a.held_out}): AUC {ver['auc']}, EER {ver['eer']}, порог {ver['thr_far1']} → "
          f"узнаём тот же катер в {ver['tpr_at_far1'] * 100:.0f} % случаев при 1 % ложных; "
          f"узнавание среди {a.held_out} по архиву из 3 проходов: {ident * 100:.0f} %")

    ver["match_z"] = tc["thr"]
    out = {"net": v_net, "scaler": sc_v, "ver": ver, "ident": ident, "vtr": vtr, "vid": vid, "center": vm.center, "cohort": cohort}
    if update is not None:
        with np.load(update, allow_pickle=False) as z:
            arrays = {k: z[k] for k in z.files if not k.startswith("vessel_")}
        meta = json.loads(str(arrays["meta"]))
        meta["vessel_dim"] = dsp.VESSEL_DIM
        meta["embedding_dim"] = int(v_net.coefs_[-2].shape[1])
        meta["thresholds"]["match"] = round(ver["thr_far1"], 3)
        meta["thresholds"]["match_z"] = ver["match_z"]
        meta["metrics"]["vessels_held_out"] = {**ver, "identification_rank1": ident, "vessels": a.held_out}
        meta["trained_on"]["synthetic_vessel_clips"] = len(vtr)
        meta["trained_on"]["train_vessels"] = len(set(vid))
        arrays["meta"] = np.array(json.dumps(meta, ensure_ascii=False))
        np.savez_compressed(update, **arrays, **pack("vessel", sc_v, v_net, "softmax"), vessel_center=vm.center.astype(np.float32),
                            vessel_cohort=cohort.astype(np.float32))
        print(f"отпечатки обновлены в {update} за {time.time() - t0:.0f} с")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--per-class", type=int, default=2000, help="синтетических клипов на класс события")
    ap.add_argument("--vessels", type=int, default=150, help="катеров для обучения отпечатков")
    ap.add_argument("--held-out", type=int, default=20, help="катеров только для проверки")
    ap.add_argument("--clips", type=int, default=30, help="проходов на катер")
    ap.add_argument("--data", type=Path, help="папка с настоящими записями")
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 2)
    ap.add_argument("--seed", type=int, default=404)
    ap.add_argument("--calibrate-only", action="store_true", help="только пересчитать пороги готовой модели")
    ap.add_argument("--vessels-only", action="store_true", help="переучить только сеть отпечатков катеров в готовой модели")
    ap.add_argument("--cal-background", type=int, default=6000, help="клипов фона для калибровки порогов")
    a = ap.parse_args()
    t0 = time.time()
    if a.calibrate_only:
        save_calibration(a.out, calibrate(a.out, a.cal_background, a.per_class // 2, a.jobs, a.seed))
        print(f"пороги обновлены в {a.out} за {time.time() - t0:.0f} с")
        return
    if a.vessels_only:
        train_vessels(a, np.random.default_rng(a.seed), a.out, t0)
        return
    rs = np.random.default_rng(a.seed)

    # ---------- события и природа ----------
    jobs = [(int(rs.integers(1 << 31)), ev) for ev in EVENTS for _ in range(a.per_class)]
    test_jobs = [(int(rs.integers(1 << 31)), ev) for ev in EVENTS for _ in range(a.per_class // 4)]
    with Pool(a.jobs) as pool:
        tr = pool.map(event_item, jobs, chunksize=16)
        te = pool.map(event_item, test_jobs, chunksize=16)
    print(f"события: {len(tr)} клипов для обучения, {len(te)} для проверки — {time.time() - t0:.0f} с")
    X = np.array([t[0] for t in tr]); y = np.array([t[1] for t in tr]); act = np.array([t[2] for t in tr])
    Xt = np.array([t[0] for t in te]); yt = np.array([t[1] for t in te]); actt = np.array([t[2] for t in te]); snrt = np.array([t[3] for t in te])
    kt = np.array([t[4] for t in te]).astype(str)
    real_ev, real_ves = real_data(a.data) if a.data else ([], [])
    if real_ev:
        X = np.vstack([X, [f for f, _ in real_ev]]); y = np.concatenate([y, [k for _, k in real_ev]])
        print(f"настоящих клипов событий: {len(real_ev)}")

    sc_e = StandardScaler().fit(X)
    ev_net = MLPClassifier(hidden_layer_sizes=(192, 96), alpha=1e-3, max_iter=400, early_stopping=True,
                           n_iter_no_change=20, random_state=a.seed).fit(sc_e.transform(X), y)
    pt = ev_net.predict_proba(sc_e.transform(Xt))
    pred = pt.argmax(1)
    cm = confusion_matrix(yt, pred, labels=range(len(EVENTS)))
    acc = float((pred == yt).mean())
    bg = (yt == 0) | (yt == 3)
    threat = pt[:, 1:3].max(1)
    thr_event = float(max(0.5, np.quantile(threat[bg], 0.98)))       # ≤ 2 % ложных тревог на чистом фоне
    rec = {EVENTS[k]: round(float(((pt[:, k] >= thr_event) & (pred == k))[yt == k].mean()), 4) for k in (1, 2)}
    false_alarm = round(float((threat[bg] >= thr_event).mean()), 4)
    motor = yt == 1
    by_snr = {}
    for name, lo, hi in (("< 3 дБ", -99, 3), ("3–10 дБ", 3, 10), ("> 10 дБ", 10, 99)):
        m = motor & (snrt >= lo) & (snrt < hi)
        if m.any():
            by_snr[name] = round(float(((pred == 1) & (pt[:, 1] >= thr_event))[m].mean()), 4)
    print(f"события: точность {acc:.3f}; порог тревоги {thr_event:.2f}: мотор {rec['motor']:.3f}, выстрел {rec['shot']:.3f}, "
          f"ложные тревоги на фоне {false_alarm:.3f}; мотор по шуму {by_snr}")
    print("матрица ошибок (строки — правда, столбцы — ответ):", EVENTS, cm.tolist(), sep="\n")
    for med in ("water", "air"):
        k = np.char.startswith(kt, med)
        print(f"  {med}: точность {float((pred[k] == yt[k]).mean()):.3f} на {int(k.sum())} клипах")

    bio_net = MLPRegressor(hidden_layer_sizes=(64, 32), alpha=1e-3, max_iter=400, early_stopping=True,
                           n_iter_no_change=20, random_state=a.seed).fit(sc_e.transform(X[: len(act)]), act)
    pa = np.clip(bio_net.predict(sc_e.transform(Xt)), 0, 1)
    bio_mae, bio_r2 = float(mean_absolute_error(actt, pa)), float(r2_score(actt, pa))
    bgm = (yt == 0) | (yt == 3)
    print(f"живость природы: ошибка {bio_mae:.3f}, R² {bio_r2:.3f} (на фоне без событий: ошибка {mean_absolute_error(actt[bgm], pa[bgm]):.3f})")

    ves = train_vessels(a, rs, None, t0, real_ves)
    v_net, sc_v, ver, ident, vtr, vid, center = ves["net"], ves["scaler"], ves["ver"], ves["ident"], ves["vtr"], ves["vid"], ves["center"]
    cohort = ves["cohort"]

    meta = {
        "version": date.today().isoformat(),
        "classes": EVENTS,
        "event_dim": dsp.EVENT_DIM, "vessel_dim": dsp.VESSEL_DIM, "embedding_dim": int(v_net.coefs_[-2].shape[1]),
        "sr": dsp.SR, "clip_s": synth.CLIP_S,
        "trained_on": {"synthetic_event_clips": len(tr), "synthetic_vessel_clips": len(vtr), "real_event_clips": len(real_ev),
                       "real_vessel_clips": len(real_ves), "train_vessels": len(set(vid))},
        "thresholds": {"event": round(thr_event, 3), "match": round(ver["thr_far1"], 3), "match_z": ver["match_z"]},
        "metrics": {
            "events": {"accuracy": round(acc, 4), "recall_motor": rec["motor"], "recall_shot": rec["shot"],
                       "accuracy_by_medium": {med: round(float((pred[np.char.startswith(kt, med)] == yt[np.char.startswith(kt, med)]).mean()), 4)
                                              for med in ("water", "air")},
                       "false_alarm_background": false_alarm, "motor_recall_by_snr": by_snr, "confusion": cm.tolist()},
            "bio": {"mae": round(bio_mae, 4), "r2": round(bio_r2, 4)},
            "vessels_held_out": {**ver, "identification_rank1": ident, "vessels": a.held_out},
        },
        "seed": a.seed,
    }
    a.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(a.out, meta=np.array(json.dumps(meta, ensure_ascii=False)),
                        **pack("events", sc_e, ev_net, "softmax"), **pack("bio", sc_e, bio_net, "identity"),
                        **pack("vessel", sc_v, v_net, "softmax"), vessel_center=center.astype(np.float32),
                        vessel_cohort=cohort.astype(np.float32))
    save_calibration(a.out, calibrate(a.out, a.cal_background, a.per_class // 2, a.jobs, a.seed))
    print(f"сохранено: {a.out} ({a.out.stat().st_size // 1024} КБ) за {time.time() - t0:.0f} с")


if __name__ == "__main__":
    main()
