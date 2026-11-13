// npm test — разбор адреса сервера и текст уведомления о тревоге (без запуска Electron)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, alertText } = require('../lib');

test('адрес сервера: https для имён, http для своей сети', () => {
  assert.equal(normalize('name-8000.app.github.dev'), 'https://name-8000.app.github.dev/');
  assert.equal(normalize('192.168.1.5:8000'), 'http://192.168.1.5:8000/');
  assert.equal(normalize('localhost:8000'), 'http://localhost:8000/');
  assert.equal(normalize('buoy.local'), 'http://buoy.local/');
  assert.equal(normalize('https://x.ru/?access=abc'), 'https://x.ru/?access=abc');
  assert.equal(normalize('  '), null);
  assert.equal(normalize('ftp://x.ru'), null);
  assert.equal(normalize('http://'), null);
});

test('уведомление о тревоге: что, где, насколько уверена сеть', () => {
  const t = alertText({ kind: 'motor', buoy_name: 'Камышовый-4', message: 'Буй Камышовый-4 услышал мотор.', confidence: 0.973 });
  assert.equal(t.title, 'Тревога: мотор — Камышовый-4');
  assert.equal(t.body, 'Буй Камышовый-4 услышал мотор. Уверенность 97 %.');
  const s = alertText({ kind: 'offline', buoy_name: 'Чаячий-6', message: 'Буй не на связи.', confidence: 1 });
  assert.equal(s.title, 'Тревога: буй не на связи — Чаячий-6');
  assert.equal(s.body, 'Буй не на связи.');                 // у «нет связи» уверенность не пишем
});

test('вход GitHub для приватного порта Codespaces остаётся в окне', () => {
  const { isSignIn } = require('../lib');
  assert.equal(isSignIn('https://github.com/login?return_to=%2Fcodespaces%2Fauth'), true);
  assert.equal(isSignIn('https://github.com/codespaces/auth/name?port=8000'), true);
  assert.equal(isSignIn('https://name-8000.app.github.dev/auth/postback/tunnel'), true);
  assert.equal(isSignIn('https://api.github.com/'), true);
  assert.equal(isSignIn('http://github.com/login'), false);          // только https
  assert.equal(isSignIn('https://evilgithub.com/login'), false);
  assert.equal(isSignIn('https://github.com.evil.ru/login'), false);
  assert.equal(isSignIn('https://ru.wikipedia.org/'), false);
  assert.equal(isSignIn('не адрес'), false);
});
