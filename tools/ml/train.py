"""Обучение нейросетей буя: события, живость природы, отпечатки катеров.

    cd tools/ml && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python train.py                     # синтетические данные, ~2 минуты на 4 ядрах
    .venv/bin/python train.py --data ~/recordings # плюс настоящие записи (см. ниже)

Настоящие записи (WAV, любая частота; длинные режутся на куски по 4 с):
    recordings/background/*.wav   ночь без угроз: ветер, вода, лягушки, птицы, самолёты
    recordings/motor/*.wav        моторы лодок
    recordings/shot/*.wav         выстрелы
    recordings/vessels/<катер>/*.wav   несколько записей одного катера — для отпечатков

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
    seed, event = args
    r = np.random.default_rng(seed)
    seg = None
    if event == "motor":                       # треть моторов звучит не весь клип: появляется или затихает внутри
        rp = np.random.default_rng(seed ^ 0x5EED)
        if rp.random() < 0.35:
            L = float(rp.uniform(0.45, 0.95))
            seg = (float(rp.uniform(0, 1 - L)), L, float(rp.uniform(0.15, 1.2)))
    x, m = synth.scene(r, event, segment=seg)
    return dsp.event_features(x), EVENTS.index(event), m["activity"], m.get("snr_db", np.nan)


def vessel_item(args):
    seed, vseed = args
    r = np.random.default_rng(seed)
    x, _ = synth.scene(r, "motor", v=synth.vessel(vseed), snr_db=float(r.uniform(3, 25)))
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
    jb = [(int(rs.integers(1 << 31)), ev) for ev, k in (("background", n_bg), ("motor", n_ev), ("shot", n_ev)) for _ in range(k)]
    with Pool(jobs) as pool:
        items = pool.map(event_item, jb, chunksize=16)
    F = np.array([t[0] for t in items]); y = np.array([t[1] for t in items]); snr = np.array([t[3] for t in items])
    P = m.events.forward(F)
    bg = y == 0
    t_motor = float(max(0.5, np.quantile(P[bg, 1], 0.99)))
    t_shot = float(max(0.5, np.quantile(P[bg, 2], 0.999)))
    fa_motor_clip = float((P[bg, 1] >= t_motor).mean())
    fa_shot_clip = float((P[bg, 2] >= t_shot).mean())
    mot, sh = y == 1, y == 2
    rec_m = float(((P[:, 1] >= t_motor) & (P.argmax(1) == 1))[mot].mean())
    rec_s = float(((P[:, 2] >= t_shot) & (P.argmax(1) == 2))[sh].mean())
    by_snr = {}
    for name, lo, hi in (("< 3 дБ", -99, 3), ("3–10 дБ", 3, 10), ("> 10 дБ", 10, 99)):
        k = mot & (snr >= lo) & (snr < hi)
        if k.any():
            by_snr[name] = round(float((P[k, 1] >= t_motor).mean()), 4)
    res = {"thresholds": {"motor": round(t_motor, 4), "shot": round(t_shot, 4)},
           "calibration": {"background_clips": int(bg.sum()), "event_clips": int((~bg).sum()),
                           "false_motor_per_clip": round(fa_motor_clip, 5), "false_motor_two_in_row": round(fa_motor_clip ** 2, 6),
                           "false_shot_per_clip": round(fa_shot_clip, 5), "motor_recall_per_clip": round(rec_m, 4),
                           "motor_recall_by_snr": by_snr, "shot_recall": round(rec_s, 4)}}
    print(f"калибровка на {int(bg.sum())} клипах фона: мотор — порог {t_motor:.3f} (ложных {fa_motor_clip:.3%} на клип, "
          f"два подряд ≈ {fa_motor_clip ** 2:.4%}), ловим {rec_m:.1%} клипов с мотором {by_snr}; "
          f"выстрел — порог {t_shot:.3f} (ложных {fa_shot_clip:.3%}), ловим {rec_s:.1%}")
    return res


def save_calibration(path: Path, cal: dict) -> None:
    with np.load(path, allow_pickle=False) as z:
        arrays = {k: z[k] for k in z.files}
    meta = json.loads(str(arrays["meta"]))
    meta["thresholds"].update(cal["thresholds"])
    meta["metrics"]["calibration"] = cal["calibration"]
    arrays["meta"] = np.array(json.dumps(meta, ensure_ascii=False))
    np.savez_compressed(path, **arrays)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--per-class", type=int, default=1600, help="синтетических клипов на класс события")
    ap.add_argument("--vessels", type=int, default=90, help="катеров для обучения отпечатков")
    ap.add_argument("--held-out", type=int, default=20, help="катеров только для проверки")
    ap.add_argument("--clips", type=int, default=28, help="проходов на катер")
    ap.add_argument("--data", type=Path, help="папка с настоящими записями")
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 2)
    ap.add_argument("--seed", type=int, default=404)
    ap.add_argument("--calibrate-only", action="store_true", help="только пересчитать пороги готовой модели")
    ap.add_argument("--cal-background", type=int, default=6000, help="клипов фона для калибровки порогов")
    a = ap.parse_args()
    t0 = time.time()
    if a.calibrate_only:
        save_calibration(a.out, calibrate(a.out, a.cal_background, a.per_class // 2, a.jobs, a.seed))
        print(f"пороги обновлены в {a.out} за {time.time() - t0:.0f} с")
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
    real_ev, real_ves = real_data(a.data) if a.data else ([], [])
    if real_ev:
        X = np.vstack([X, [f for f, _ in real_ev]]); y = np.concatenate([y, [k for _, k in real_ev]])
        print(f"настоящих клипов событий: {len(real_ev)}")

    sc_e = StandardScaler().fit(X)
    ev_net = MLPClassifier(hidden_layer_sizes=(128, 64), alpha=1e-3, max_iter=400, early_stopping=True,
                           n_iter_no_change=20, random_state=a.seed).fit(sc_e.transform(X), y)
    pt = ev_net.predict_proba(sc_e.transform(Xt))
    pred = pt.argmax(1)
    cm = confusion_matrix(yt, pred, labels=range(len(EVENTS)))
    acc = float((pred == yt).mean())
    bg = yt == 0
    threat = pt[:, 1:].max(1)
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

    bio_net = MLPRegressor(hidden_layer_sizes=(64, 32), alpha=1e-3, max_iter=400, early_stopping=True,
                           n_iter_no_change=20, random_state=a.seed).fit(sc_e.transform(X[: len(act)]), act)
    pa = np.clip(bio_net.predict(sc_e.transform(Xt)), 0, 1)
    bio_mae, bio_r2 = float(mean_absolute_error(actt, pa)), float(r2_score(actt, pa))
    bgm = yt == 0
    print(f"живость природы: ошибка {bio_mae:.3f}, R² {bio_r2:.3f} (на фоне без событий: ошибка {mean_absolute_error(actt[bgm], pa[bgm]):.3f})")

    # ---------- отпечатки катеров ----------
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
    Ht = np.array([t[0] for t in vte]); hid = np.array([t[1] for t in vte])
    emb = vm.embed(Ht)
    ver = verification(emb, hid)
    ident = identification(emb, hid)
    print(f"отпечатки на новых катерах ({a.held_out}): AUC {ver['auc']}, EER {ver['eer']}, порог {ver['thr_far1']} → "
          f"узнаём тот же катер в {ver['tpr_at_far1'] * 100:.0f} % случаев при 1 % ложных; "
          f"узнавание среди {a.held_out} по архиву из 3 проходов: {ident * 100:.0f} %")

    meta = {
        "version": date.today().isoformat(),
        "classes": EVENTS,
        "event_dim": dsp.EVENT_DIM, "vessel_dim": dsp.VESSEL_DIM, "embedding_dim": int(v_net.coefs_[-2].shape[1]),
        "sr": dsp.SR, "clip_s": synth.CLIP_S,
        "trained_on": {"synthetic_event_clips": len(tr), "synthetic_vessel_clips": len(vtr), "real_event_clips": len(real_ev),
                       "real_vessel_clips": len(real_ves), "train_vessels": len(set(vid))},
        "thresholds": {"event": round(thr_event, 3), "match": round(ver["thr_far1"], 3)},
        "metrics": {
            "events": {"accuracy": round(acc, 4), "recall_motor": rec["motor"], "recall_shot": rec["shot"],
                       "false_alarm_background": false_alarm, "motor_recall_by_snr": by_snr, "confusion": cm.tolist()},
            "bio": {"mae": round(bio_mae, 4), "r2": round(bio_r2, 4)},
            "vessels_held_out": {**ver, "identification_rank1": ident, "vessels": a.held_out},
        },
        "seed": a.seed,
    }
    a.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(a.out, meta=np.array(json.dumps(meta, ensure_ascii=False)),
                        **pack("events", sc_e, ev_net, "softmax"), **pack("bio", sc_e, bio_net, "identity"),
                        **pack("vessel", sc_v, v_net, "softmax"))
    save_calibration(a.out, calibrate(a.out, a.cal_background, a.per_class // 2, a.jobs, a.seed))
    print(f"сохранено: {a.out} ({a.out.stat().st_size // 1024} КБ) за {time.time() - t0:.0f} с")


if __name__ == "__main__":
    main()
