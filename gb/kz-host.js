'use strict';
/* 黒墨商店 真夜中のドーナツパズル: the GameBull Stage Mode API for the client's page.
 *
 * Their game has no GameBull code and no lives (600 stages, any stage playable, records in this browser). This file
 * is the API client the other Stage Mode games use (gamebull-whitelabel ADR-0086, contracts/stage-mode.ts; the
 * Stance, Himi Kiju, Yukiya, PONTE and PHOTO JIGSAW ports); gb/kz-hooks.js puts it on their page:
 *
 *   check           GET  /play/games/{gameId}/context?tenantSlug   (Bearer bootToken) -> lives.count, stageMode
 *   begin(stage)    POST /play/plays {bootToken, stage}            1 Life on the server (PAID: the next stage); a
 *                                                                   cleared stage is a FREE_REPLAY when the admin
 *                                                                   allows it, refused otherwise
 *   completeStage   POST /play/stage-clears {sessionToken, playTimeMs} -> status, progress, the all-clear reward
 *
 * Lives are never counted here: the balance is the server's (/context lives.count).
 * What the API does not have, and what this file does instead:
 *  - idempotent starts: the API has no idempotency key. A start still in flight for a stage is awaited, not sent
 *    again; a start whose answer was lost (network / 5xx) is never re-sent: the player is told a Life may have been
 *    used, and the next start is a new entry;
 *  - unlimited time: GameBull requires a time per attempt (maxAttemptSeconds, at most 3540 s) and the play token lives
 *    1 h, so an attempt ends at its deadline (gb/kz-hooks.js shows the time left in the last 10 minutes).
 * Attempts are kept in sessionStorage (this tab; the play token never goes into their storage).
 */
(function () {
  const ENV = window.KZ_GB || {};
  const TOTAL = 600; // their page: 600 stages in #campaign (checked at build time), "600" written all over their UI
  const log = (...a) => console.log('[KZ-GB]', ...a);

  const q = new URLSearchParams(location.search);
  // The GameBull app launches with ?tenantSlug&bootToken&gameId&returnUrl&apiBase (use-launch-game.ts); the other
  // ports' SDK also accepts sessionToken / token, in that order (playbook section 2).
  const token = q.get('bootToken') || q.get('sessionToken') || q.get('token') || '';
  const tenant = q.get('tenantSlug') || '';
  const api = ((ENV.dev && q.get('devApi')) || ENV.apiBase || '').replace(/\/+$/, '');
  const jwtPayload = t => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; } };
  const player = (jwtPayload(token) || {}).globalUserId || 'unknown';
  const KEY = 'kz-gb:v1:' + tenant + ':' + ENV.gameId + ':' + player;

  class StageError extends Error { constructor(code, message) { super(message); this.name = 'StageError'; this.code = code; } }
  // Server codes -> Japanese (the wording of the other Stage Mode screens; their game has no such messages).
  const MESSAGES = {
    'play.no_lives': 'ライフがありません。GameBullでライフをご確認ください。',
    'stage.daily_limit_reached': '本日の挑戦回数の上限に達しました。進行状況はGameBullに保存されています。',
    'stage.stage_not_playable': 'このステージはまだ遊べません。前のステージをクリアすると遊べるようになります。',
    'stage.all_cleared': '全600ステージ達成済みです。特典はGameBullでご確認ください。',
    'stage.stage_required': 'ステージ番号の送信に問題があります。開発者へお問い合わせください。',
    'stage.play_token_required': '参加情報を確認できません。もう一度お試しください。',
    'play.session_token_expired': '参加の有効期限が切れました。GameBullのゲーム画面から開き直してください。',
    'play.session_token_invalid': 'GameBullへの接続に失敗しました。GameBullのゲーム画面から開き直してください。',
    'guest.session_invalid': 'GameBullへの接続に失敗しました。GameBullのゲーム画面から開き直してください。',
    'stage.score_not_accepted': 'クリア報告の設定に問題があります。開発者へお問い合わせください。',
    'play.mode_not_enabled': 'このゲームのステージモードをGameBull側で有効にしてください。'
  };
  const fail = (code, message) => new StageError(code, message || MESSAGES[code] || 'GameBullへの接続に失敗しました。');

  /* ── storage (sessionStorage, this tab only) ── */
  const blank = () => ({ attempts: {} });
  let store = blank();
  try { const s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (s && s.attempts) store = Object.assign(blank(), s); } catch { /* private mode */ }
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode */ } };

  /* ── server ── */
  let n = 0, ctx = null;
  async function request(path, { method = 'GET', body, bearer } = {}) {
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 15000);
    const headers = { Accept: 'application/json' };
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    if (body) headers['Content-Type'] = 'application/json';
    // GETs are cache-busted with a unique URL (a cached /context showed lives one play behind, playbook section 3).
    const url = api + path + (method === 'GET' ? (path.includes('?') ? '&' : '?') + '_ts=' + Date.now() + '-' + (++n) : '');
    let response, data;
    try {
      response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: abort.signal,
        cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    } catch { throw fail('network', '通信結果を確認できませんでした。接続を確認してください。'); }
    finally { clearTimeout(timeout); }
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) {
      // Codes arrive nested ({error:{code}}) or top-level ({code}) (playbook section 3, error shapes).
      const code = (data && data.error && data.error.code) || (data && typeof data.code === 'string' && data.code) || 'http_' + response.status;
      const e = fail(code, MESSAGES[code] || (response.status >= 500 ? 'GameBullへの接続に失敗しました。時間をおいてお試しください。' : 'GameBullへの接続に失敗しました。'));
      e.httpStatus = response.status; throw e;
    }
    if (!data || typeof data !== 'object') throw fail('bad_response', 'GameBullからの応答を確認できませんでした。');
    return data;
  }

  async function refresh() {
    if (!api) throw fail('not_configured', 'GameBullの接続先が未設定です。開発者に接続設定を依頼してください。');
    if (!token || !tenant) throw fail('launch_required', 'GameBullのゲーム画面から開いてください。');
    const data = await request('/play/games/' + encodeURIComponent(ENV.gameId) + '/context?tenantSlug=' + encodeURIComponent(tenant), { bearer: token });
    const m = data.stageMode;
    // stageMode is sent only for a "Play Stage Mode" launch (boot token mode STAGE_CLEAR); "Game Start" gets null.
    if (!m) throw fail('stage_mode_required', 'このゲームはステージモードで遊べます。GameBullのゲーム画面の「Play Stage Mode」から開いてください。');
    const h = m.highestCleared;
    if (m.totalStages !== TOTAL) throw fail('bad_context', 'GameBullのステージ数が600ではありません（' + m.totalStages + '）。管理者に確認してください。');
    if (!Number.isInteger(h) || h < 0 || h > TOTAL || (h >= TOTAL ? m.nextStage !== null : m.nextStage !== h + 1) || !(m.maxAttemptSeconds > 0))
      throw fail('bad_context', 'ステージ情報がゲームと一致しません。管理者に確認してください。');
    const first = !ctx;
    ctx = data;
    if (first) log(`Build v${ENV.build}. /context has stageMode (cleared ${h}/${m.totalStages}, next ${m.nextStage}, ` +
      `${m.maxAttemptSeconds} s per attempt, free replays ${m.freeReplays ? 'on' : 'off'}, daily limit ${m.dailyAttemptLimit ?? 'none'}), ${lives()} Lives.`);
    dispatchEvent(new CustomEvent('kz-gb:context', { detail: data }));
    return data;
  }
  const lives = () => { const c = ctx && ctx.lives && ctx.lives.count; return Number.isInteger(c) && c >= 0 ? c : 0; };

  /* ── attempts ── */
  function live(a) {
    if (!a || a.ended || a.result || a.clearBody) return false;
    const exp = jwtPayload(a.token);
    return !!exp && exp.exp * 1000 > Date.now() && Date.now() < a.deadline;
  }
  function close(a, why) {
    if (!a || a.ended) return;
    a.ended = true; save(); log(`Attempt ${a.attemptId} (stage ${a.stage}) closed (${why}).`);
  }
  function prune() {
    const ids = Object.keys(store.attempts).sort((x, y) => store.attempts[x].startedAt - store.attempts[y].startedAt);
    for (const id of ids.slice(0, Math.max(0, ids.length - 30))) if (!store.attempts[id].clearBody || store.attempts[id].result) delete store.attempts[id];
  }
  // The running attempt for a stage in this tab (one per stage), or null.
  const attemptFor = stage => Object.values(store.attempts).find(a => a.stage === stage && live(a)) || null;

  // A clear the server has not confirmed yet (lost answer) is sent again before anything else: their page has
  // already recorded it locally, so the server must catch up first.
  async function settlePendingClears() {
    for (const a of Object.values(store.attempts)) {
      if (!a.clearBody || a.result) continue;
      const r = await sendClear(a);
      if (!r.ok && !r.final) throw fail(r.code || 'clear_pending', 'ステージ' + a.stage + 'のクリア記録をGameBullに送信できませんでした。通信を確認して、もう一度お試しください。');
    }
  }

  const inflight = new Map();
  function begin(stage) {
    if (inflight.has(stage)) return inflight.get(stage);
    const p = enter(stage).finally(() => inflight.delete(stage));
    inflight.set(stage, p);
    return p;
  }

  async function enter(stage) {
    if (!Number.isInteger(stage) || stage < 1 || stage > TOTAL) throw fail('bad_request', '開始情報を確認できません。');
    await refresh();
    await settlePendingClears();
    const running = attemptFor(stage);
    if (running) { log(`Stage ${stage}: running attempt ${running.attemptId} reused (no Life).`); return running; }
    const m = ctx.stageMode;
    const replay = m.nextStage === null || stage < m.nextStage;
    if (!replay && stage > m.nextStage) throw fail('stage.stage_not_playable');
    if (replay && !m.freeReplays) throw fail('replay_off', m.nextStage === null ? MESSAGES['stage.all_cleared']
      : 'ステージ' + stage + 'はクリア済みです。GameBullのステージモードでは、クリア済みステージは遊べません。続きのステージ' + m.nextStage + 'へ進んでください。');

    let data;
    try { data = await request('/play/plays', { method: 'POST', body: { bootToken: token, stage } }); }
    catch (e) {
      if (e.code === 'network' || e.httpStatus >= 500) {
        // No idempotency key on this call: an unknown answer is never re-sent. The next start is a new entry.
        try { await refresh(); } catch { /* keep the message below */ }
        log(`Stage ${stage} entry answer lost (${e.code}); not re-sent.`);
        throw fail('entry_lost', '開始結果を確認できませんでした。ライフが使われた可能性があります（残りライフ ' + lives() + '）。もう一度始めると、新しい挑戦になります（ライフ1）。');
      }
      if (e.code === 'play.no_lives') { try { await refresh(); } catch { /* shown below */ } }
      log(`Stage ${stage} entry refused: ${e.code}.`);
      throw e;
    }
    const sm = data.stageMode, deadline = Date.parse(sm && sm.deadlineAt), expires = Date.parse(data.expiresAt);
    if (typeof data.playToken !== 'string' || !data.playToken || data.mode !== 'STAGE_CLEAR' || !sm || sm.stage !== stage
      || !['PAID', 'FREE_REPLAY'].includes(sm.kind) || !Number.isFinite(deadline) || !(sm.maxAttemptSeconds > 0))
      throw fail('bad_response', 'GameBullから正しい開始情報を取得できませんでした。');
    const startedAt = Date.now();
    const a = { attemptId: 'gb-' + data.playToken.slice(-12) + '-' + startedAt.toString(36), stage, token: data.playToken, kind: sm.kind,
      startedAt, limitSeconds: sm.maxAttemptSeconds,
      deadline: Math.min(deadline, Number.isFinite(expires) ? expires : Infinity, startedAt + sm.maxAttemptSeconds * 1000),
      ended: false, clearBody: null, result: null };
    for (const o of Object.values(store.attempts)) if (o.stage === stage && !o.clearBody) close(o, 'replaced by a new attempt');
    store.attempts[a.attemptId] = a;
    prune(); save();
    log(`Stage ${stage} entered (${sm.kind}${sm.kind === 'PAID' ? ', 1 Life on the server' : ', free'}), limit ${sm.maxAttemptSeconds} s.`);
    try { await refresh(); } catch { /* the entry stands; lives refresh on the next call */ }
    return a;
  }

  /* ── clear report ── */
  async function sendClear(a) {
    let data;
    try { data = await request('/play/stage-clears', { method: 'POST', body: a.clearBody }); }
    catch (e) {
      // Safe resend: the same play token and playTimeMs (the server answers a repeat with its stored verdict).
      log(`Stage ${a.stage} clear not confirmed (${e.code}); it is sent again with the same report.`);
      if (e.code === 'play.session_token_expired' || e.code === 'stage.play_token_required') {
        a.result = { status: 'TOKEN_REFUSED', stage: a.stage }; close(a, 'token refused'); return { ok: false, code: e.code, message: e.message, final: true };
      }
      return { ok: false, code: e.code, message: e.message };
    }
    if (!['CLEARED', 'ALREADY_CLEARED', 'REPLAY', 'TIME_EXCEEDED'].includes(data.status) || data.stage !== a.stage)
      return { ok: false, code: 'bad_response', message: 'クリア判定を確認できませんでした。' };
    a.result = data; close(a, 'clear ' + data.status);
    log(`Stage ${a.stage} clear: ${data.status} (${data.highestCleared}/${data.totalStages} cleared${data.reward ? ', reward ' + data.reward.status : ''}).`);
    try { await refresh(); } catch { /* the clear answer is authoritative */ }
    dispatchEvent(new CustomEvent('kz-gb:clear', { detail: data }));
    return { ok: true, result: data };
  }

  // Called by gb/kz-hooks.js when their board is solved. Returns { ok, result } or { ok:false, message, final }
  // (final: no resend can help).
  async function completeStage(attemptId) {
    const a = store.attempts[attemptId];
    if (!a) return { ok: false, final: true, message: 'この盤面はGameBullの挑戦として記録できませんでした。' };
    if (a.result) return a.result.status === 'TOKEN_REFUSED' ? { ok: false, final: true, message: MESSAGES['play.session_token_expired'] } : { ok: true, result: a.result };
    if (!a.clearBody) {
      if (a.ended) return { ok: false, final: true, message: 'この挑戦は終了しています。' };
      a.clearBody = { sessionToken: a.token, playTimeMs: Math.max(0, Date.now() - a.startedAt) };
      save();
    }
    return sendClear(a);
  }

  window.KZGB = {
    get context() { return ctx; },
    get lives() { return lives(); },
    embedded: window.parent !== window,
    check: refresh,
    begin,
    attemptFor,
    attempt(id) { return store.attempts[id] || null; },
    remainingMs(id) { const a = store.attempts[id]; return a && !a.ended ? Math.max(0, a.deadline - Date.now()) : 0; },
    // Time limit reached on screen: the attempt is over; the next start of this stage is a new entry.
    timeUp(id) { const a = store.attempts[id]; if (a && !a.clearBody) close(a, 'time limit'); },
    completeStage,
    settlePendingClears
  };
})();
