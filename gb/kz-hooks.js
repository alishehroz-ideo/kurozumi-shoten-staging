'use strict';
/* 黒墨商店 真夜中のドーナツパズル: GameBull Stage Mode on the client's page, loaded after their last script (their
 * page unchanged). Classic scripts share globals, so their function declarations (load, finish, rotate, renderMap,
 * updateProgress, showTitle, modalOpen) are wrapped and their lets read (index, level, won, paused, save). What this
 * adds, all for GameBull Stage Mode (their game has no lives and lets any stage be played):
 *  - a start costs what GameBull says: every way into a stage (their ゲームスタート, 次のステージへ, もう一度, ステージ
 *    一覧, 続きからプレイ, the stage number box) asks GameBull for an attempt first (gb/kz-host.js begin: 1 Life for the
 *    next stage, free or refused for a cleared one); their やり直す (↻ / R) inside a running attempt is free, as their
 *    unlimited 一手戻す already is;
 *  - stages in order: stages after GameBull's next stage are locked in their stage list;
 *  - the clear report: when their board is solved, the clear goes to GameBull and their 次のステージへ shows once
 *    GameBull has it;
 *  - progress from the server: the stage shown on their title and their クリア counts follow GameBull's
 *    highestCleared / nextStage (their stars and best moves stay their own records in this browser);
 *  - GameBull's Lives in their HUD and on their title; the attempt's time limit (GameBull requires one, at most
 *    59 min) shown in the last 10 minutes; at 0 the attempt is over and a new one costs a Life;
 *  - the all-clear voucher (stage 600) in a dialog; its button closes the game into the GameBull app's coupon
 *    (gamebull:close + to: /coupons/<id>, relayed by the loading page; trap W18);
 *  - a launch that cannot play (Game Start, no launch data) says so, with a way back to GameBull;
 *  - their music from the first tap anywhere (also on their title), Web Audio on iPhone (trap W2), no zoom (trap W7);
 *  - the GameBull app's expanded-view corners kept clear (KZFit, called by loader.ts too).
 */
(function () {
  const ENV = window.KZ_GB || {};
  const gb = () => window.KZGB;
  const log = (...a) => console.log('[KZ-GB]', ...a);
  const el = id => document.getElementById(id);
  const pad = n => String(n).padStart(3, '0');
  log(`Build v${ENV.build} (${ENV.gameId}, API ${ENV.apiBase}).`);

  /* ── no pinch / double-tap / ctrl+wheel zoom (trap W7; the viewport meta seam covers the rest) ── */
  {
    const stop = e => { if (e.cancelable) e.preventDefault(); };
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, stop, { passive: false });
    document.addEventListener('touchmove', e => { if (e.touches.length > 1) stop(e); }, { passive: false });
    document.addEventListener('wheel', e => { if (e.ctrlKey) stop(e); }, { passive: false });
    document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) stop(e); });
  }

  function closeToGameBull(to) {
    if (!gb().embedded) return false;
    const msg = { type: 'gamebull:close' }; if (to) msg.to = to;
    log('gamebull:close ' + JSON.stringify(msg) + ' (through the loading page relay).');
    window.parent.postMessage(msg, location.origin);
    return true;
  }

  /* ── styles for the few GameBull elements (scoped to .kzgb-*, trap W10; colours from their night.css / title.css) ── */
  const css = document.createElement('style');
  css.textContent = `
  .kzgb-lives{flex:0 0 auto;align-self:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:52px;
    padding:4px 8px;border:1px solid #c6af83;border-radius:5px;background:linear-gradient(145deg,#111d32f5,#040b17f0);
    box-shadow:inset 0 0 0 2px #1b2a40,0 2px 4px #0005;color:#fff1d6;font:600 10px/1.25 system-ui,sans-serif;letter-spacing:.5px;white-space:nowrap}
  .kzgb-lives b{font-size:15px;font-variant-numeric:tabular-nums;margin-left:3px}
  .kzgb-lives .kzgb-time{font-size:10px;font-weight:600;color:#f0ce86;font-variant-numeric:tabular-nums}
  .kzgb-lives .kzgb-time[hidden]{display:none}
  .kzgb-lives .kzgb-time.kzgb-low{color:#ff9f8a}
  .title-start{position:relative}
  .kzgb-title-lives{position:absolute;top:-10px;right:12px;margin:0;padding:1px 9px;white-space:nowrap;pointer-events:none;
    border:1px solid #e6c991;border-radius:9px;background:linear-gradient(145deg,#111d32,#040b17);box-shadow:0 2px 4px #0006;
    font:600 9px/16px system-ui,sans-serif;letter-spacing:1px;color:#dfcba4}
  .kzgb-title-lives b{color:#fff0d3;font-size:11px;margin-left:4px}
  .kzgb-clear{margin:10px 0 0;font-size:11px;line-height:1.7;color:#f0ce86;white-space:pre-line}
  .kzgb-clear[hidden]{display:none}
  .kzgb-clear button{display:block;margin:8px auto 0}
  .kzgb-dialog{width:min(420px,calc(100vw - 24px))}
  .kzgb-dialog p{white-space:pre-line;font-size:13px;line-height:1.9;margin:0 0 6px}
  .kzgb-dialog h2{margin:0 0 10px;font-size:20px;color:#fff0d6}
  .kzgb-dialog img{display:block;max-width:100%;max-height:160px;margin:10px auto;border-radius:8px}
  .kzgb-dialog .primary{display:block;width:100%;margin-top:14px}
  .kzgb-dialog .kzgb-secondary{display:block;width:100%;margin-top:10px;min-height:44px;background:#15243a;color:#f6e5c7;border:1px solid #a98c60;border-radius:5px;font-size:12px}
  .stage-grid button.kzgb-locked{opacity:.32;cursor:not-allowed}
  /* fixed window: their page is one portrait surface; no scrollbar */
  html{scrollbar-width:none}html::-webkit-scrollbar{display:none}`;
  document.head.appendChild(css);

  /* ── page dialogs (their dialog look: their .modal and .primary) ── */
  const dialog = document.createElement('dialog');
  dialog.className = 'modal kzgb-dialog'; dialog.setAttribute('aria-live', 'assertive');
  document.body.appendChild(dialog);
  // buttons: [{label, primary, run}]; Esc closes like the first non-primary button (or the only one).
  function showDialog(nodes, buttons) {
    dialog.replaceChildren(...nodes);
    let onCancel = null;
    for (const b of buttons) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = b.primary ? 'primary' : 'kzgb-secondary'; button.textContent = b.label;
      button.onclick = () => { dialog.close(); if (b.run) b.run(); };
      dialog.append(button);
      if (!b.primary || buttons.length === 1) onCancel = onCancel || b.run || (() => {});
    }
    dialog.oncancel = e => { e.preventDefault(); dialog.close(); if (onCancel) onCancel(); };
    if (dialog.open) dialog.close();
    try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
  }
  const para = text => { const p = document.createElement('p'); p.textContent = text; return p; };
  const notice = (text, then) => showDialog([para(text)], [{ label: 'OK', primary: true, run: then }]);
  // Their keys and moves stop while a GameBull dialog is open, as they do for their own dialogs.
  const theirModalOpen = modalOpen;
  modalOpen = function () { return theirModalOpen() || dialog.open; };

  /* ── GameBull's progress and Lives ── */
  const sm = () => gb().context && gb().context.stageMode;
  const nextStage = () => { const m = sm(); return m ? (m.nextStage === null ? 600 : m.nextStage) : null; };
  const highest = () => { const m = sm(); return m ? m.highestCleared : 0; };
  const titleShown = () => !el('titleScreen').hidden;

  // In their HUD, between their STAGE box and their 回転数 / 目標 box; the time left shows under it in the last 10 min.
  const pill = document.createElement('div');
  pill.className = 'kzgb-lives'; pill.setAttribute('role', 'status');
  const pillLives = document.createElement('span'), timer = document.createElement('span');
  timer.className = 'kzgb-time'; timer.hidden = true;
  pill.append(pillLives, timer);
  document.querySelector('.game-top .stats').before(pill);
  // On their title: a small badge on the top edge of their ゲームスタート button (it adds no height: their title fits
  // short windows exactly, with no room above their seal). Hidden from screen readers: their button keeps its name.
  const titleLives = document.createElement('span');
  titleLives.className = 'kzgb-title-lives'; titleLives.setAttribute('aria-hidden', 'true');
  el('startGame').append(titleLives);
  function showLives() {
    const ok = !!sm(), n = gb().lives;
    pillLives.replaceChildren(document.createTextNode('ライフ'), Object.assign(document.createElement('b'), { textContent: ok ? n : '–' }));
    titleLives.replaceChildren(document.createTextNode('GameBull ライフ'), Object.assign(document.createElement('b'), { textContent: ok ? n : '–' }));
    pill.setAttribute('aria-label', 'GameBullライフ ' + (ok ? n : '不明'));
  }
  showLives();

  // Their クリア counts follow GameBull (their stars and best moves stay their own records).
  const theirUpdateProgress = updateProgress;
  updateProgress = function () {
    theirUpdateProgress.apply(this, arguments);
    if (sm()) el('totalCleared').textContent = highest();
  };
  // Their stage list: stages after GameBull's next stage are locked; a stage GameBull has as cleared but this browser
  // has no record of (another device) shows as cleared.
  const theirRenderMap = renderMap;
  renderMap = function () {
    theirRenderMap.apply(this, arguments);
    const nx = nextStage();
    if (nx === null) return;
    const lo = mapChapter * 50;
    el('stageGrid').querySelectorAll('button').forEach((b, i) => {
      const id = lo + i + 1;
      if (id > nx) { b.disabled = true; b.classList.add('kzgb-locked'); b.setAttribute('aria-label', `ステージ${id}、未開放`); }
      else if (id <= highest() && !save.records[id]) { const s = b.querySelector('.starline'); if (s) s.textContent = '✓'; }
    });
    const stars = Object.values(save.records).reduce((a, r) => a + r.stars, 0);
    el('mapSummary').textContent = `${highest()} / 600 クリア · ${stars} / 1800 星`;
  };
  let firstSync = true;
  function syncProgress() {
    showLives();
    if (!sm()) return;
    updateProgress();
    if (el('mapDialog').open) renderMap();
    // At start-up their page shows their own last stage under the title: GameBull's next stage instead, and their
    // title line follows it (their showTitle() writes it).
    if (firstSync && titleShown() && !won) {
      firstSync = false;
      const i = nextStage() - 1;
      if (index !== i) { theirLoad(i); log(`Their board follows GameBull: stage ${i + 1} (${highest()} cleared).`); }
      showTitle();
    }
  }
  addEventListener('kz-gb:context', syncProgress);

  /* ── starts: every way into a stage asks GameBull for an attempt first ── */
  const theirLoad = load;
  let cur = null, busy = false;    // cur: the attempt of the stage on their board
  const running = () => gb().attemptFor(index + 1);
  function refusal(e) {
    log(`Start refused: ${e.code} (${e.message}).`);
    const buttons = [{ label: 'OK', primary: true }];
    if (['play.no_lives', 'stage_mode_required', 'launch_required', 'play.session_token_invalid', 'guest.session_invalid', 'play.session_token_expired'].includes(e.code) && gb().embedded)
      buttons.push({ label: 'GameBullに戻る', run: () => closeToGameBull() });
    showDialog([para(e.message)], buttons);
  }
  // Resolves to the attempt for stage n (an existing running one, or a new entry), or null (refused; told).
  function enter(n) {
    const a = gb().attemptFor(n);
    if (a) return Promise.resolve(a);
    if (busy) return Promise.resolve(null);
    busy = true; el('startGame').disabled = true;
    if (!titleShown()) notify('GameBullに接続しています…', 15000);
    return gb().begin(n).then(a => { el('toast').hidden = true; return a; },
      e => { el('toast').hidden = true; refusal(e); return null; })
      .finally(() => { busy = false; el('startGame').disabled = false; });
  }
  load = function (i) {
    i = Math.max(0, Math.min(599, i));
    const a = gb().attemptFor(i + 1);
    if (a) { cur = a; return theirLoad(i); }              // their やり直す in a running attempt: free, as before
    enter(i + 1).then(a => { if (a) { cur = a; theirLoad(i); } });
  };
  // Their ゲームスタート: the stage on their board, entered first. Their sound starts inside this tap (iPhone: not
  // after the server answer).
  const theirStart = el('startGame').onclick;
  el('startGame').onclick = function (e) {
    try { NightAudio.unlock(); } catch { /* their audio */ }
    const go = () => theirStart.call(el('startGame'), e);
    if (won || running()) { if (!won) cur = running(); return go(); }   // a solved board or a running attempt: as theirs
    enter(index + 1).then(a => { if (a) { cur = a; theirLoad(index); go(); } });
  };
  // Their 続きからプレイ (first stage without a record in this browser): GameBull's next stage.
  el('continue').onclick = () => { const nx = nextStage(); load(nx === null ? index : nx - 1); el('mapDialog').close(); };
  // A move on a board with no running attempt (its time ran out) asks to start a new one first.
  const theirRotate = rotate;
  rotate = function (d) {
    if (!won && !titleShown() && !theirModalOpen() && !dialog.open && !running()) {
      showDialog([para(`ステージ${pad(index + 1)}を始めますか？`)], [{ label: '挑戦する', primary: true, run: () => load(index) }, { label: 'キャンセル' }]);
      return;
    }
    return theirRotate.apply(this, arguments);
  };

  /* ── clear report: their board solved -> GameBull; their 次のステージへ once GameBull has it ── */
  const line = document.createElement('p');
  line.className = 'kzgb-clear'; line.hidden = true; line.setAttribute('role', 'status');
  el('result').after(line);
  function setLine(text, resend) {
    line.replaceChildren(document.createTextNode(text));
    if (resend) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'primary'; b.textContent = 'クリア記録を再送信';
      b.onclick = () => { if (report && report.state === 'failed') send(report); };
      line.append(b);
    }
    line.hidden = !text;
    fitPanel();
  }
  // Their finish panel is centred in the board and clipped by it (their .viewport overflow:hidden). On a short board
  // (their 560 px minimum page: 320x568, landscape, the GameBull app on a small iPhone) their own panel is already
  // taller than the board, so their もう一度 / ステージ一覧 are cut off (their page as delivered too), and the GameBull
  // line adds one more line. The whole panel is then scaled down to the board's height, centred as theirs: same
  // design, same proportions, every button on the board and tappable.
  function fitPanel() {
    const veil = el('finish'), pc = veil.querySelector('.panel-content');
    pc.style.transform = ''; pc.style.transformOrigin = '';
    if (veil.hidden) return;
    const need = pc.offsetHeight, have = veil.clientHeight - 8;
    if (need <= have) return;
    // An overflowing grid item is not centred (their .veil place-items:center), so: scaled from its top edge, then
    // moved to the middle of the board.
    const k = have / need, top = (veil.clientHeight - need * k) / 2 - pc.offsetTop;
    pc.style.transformOrigin = '50% 0';
    pc.style.transform = `translateY(${top.toFixed(1)}px) scale(${k.toFixed(3)})`;
    log(`Their finish panel (${need} px) scaled to the board (${have} px).`);
  }
  addEventListener('resize', fitPanel);
  let report = null; // { attemptId, stage, state: sending | ok | failed | final }
  async function send(r) {
    r.state = 'sending'; setLine('GameBullに記録しています…');
    const res = await gb().completeStage(r.attemptId);
    if (report !== r) return;
    if (res.ok) {
      const d = res.result;
      if (d.status === 'CLEARED' || d.status === 'ALREADY_CLEARED') { r.state = 'ok'; setLine('GameBullに記録しました（' + d.highestCleared + ' / 600）'); }
      else if (d.status === 'REPLAY') { r.state = 'ok'; setLine('再挑戦のクリア（GameBullの記録は変わりません）'); }
      else { r.state = 'final'; setLine('制限時間切れのため記録されませんでした。\n「もう一度」で再挑戦できます（ライフ1）'); }
      if (r.state === 'ok' && index + 1 === r.stage && won) { el('next').hidden = false; fitPanel(); }
      if (d.reward) showReward(d.reward);
    } else if (res.final) { r.state = 'final'; setLine(res.message); }
    else { r.state = 'failed'; setLine(res.message, true); }
  }
  const theirFinish = finish;
  finish = function () {
    const was = won;
    theirFinish.apply(this, arguments);
    if (was || !won) return;
    const stage = index + 1, a = cur && cur.stage === stage ? cur : null;
    el('next').hidden = true;
    if (!a) { report = null; setLine('この盤面はGameBullの挑戦として記録できませんでした。'); log(`Stage ${stage} solved without a GameBull attempt.`); return; }
    report = { attemptId: a.attemptId, stage, state: '' };
    log(`Stage ${stage}: solved in ${moves} turns (${elapsed.toFixed(1)} s on their clock); reporting the clear.`);
    send(report);
  };
  // Their next board (any load hides their finish panel) starts without the GameBull line; their 次のステージへ is
  // theirs again.
  new MutationObserver(() => { if (el('finish').hidden) { report = null; setLine(''); el('next').hidden = false; } })
    .observe(el('finish'), { attributes: true, attributeFilter: ['hidden'] });

  /* ── time limit: shown under the Lives in the last 10 minutes; at 0 the attempt is over ── */
  const fmt = ms => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  let overId = null;
  function timeUp(a) {
    overId = a.attemptId;
    gb().timeUp(a.attemptId);
    log(`Stage ${a.stage}: attempt time limit reached.`);
    if (theirModalOpen() && !titleShown()) for (const id of ['mapDialog', 'helpDialog', 'audioDialog']) if (el(id).open) el(id).close();
    showDialog([para('制限時間になりました。\nもう一度挑戦すると、ライフを1つ使います。')], [
      { label: 'もう一度挑戦する', primary: true, run: () => load(index) },
      { label: 'タイトルへ', run: () => showTitle() }]);
  }
  setInterval(() => {
    const a = cur && cur.stage === index + 1 ? gb().attempt(cur.attemptId) : null;
    const on = !!(a && !won && !a.clearBody && !a.result);
    const left = on ? gb().remainingMs(a.attemptId) : 0;
    timer.hidden = !on || left > 600000;
    if (!on) return;
    timer.textContent = '残り ' + fmt(left);
    timer.classList.toggle('kzgb-low', left <= 60000);
    if (left <= 0 && overId !== a.attemptId && !titleShown()) timeUp(a);
  }, 250);

  /* ── the all-clear voucher (their modal look) ── */
  const safeUrl = v => { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password ? u : null; } catch { return null; } };
  function showReward(reward) {
    log('All-clear reward: ' + reward.status + '.');
    if (reward.status === 'NONE_CONFIGURED') return;
    const text = { ISSUED: 'ギフト券が発行され、GameBullのクーポン一覧に入りました。', ALREADY_CLAIMED: 'この店舗の特典はすでに受け取り済みです。',
      OUT_OF_STOCK: '特典は一時的に在庫切れです。後でGameBullアプリのゲーム画面から受け取れます。' }[reward.status] ?? '特典の状態はGameBullでご確認ください。';
    const h = document.createElement('h2'); h.textContent = reward.title || '全ステージ達成特典';
    const nodes = [h, para('全600ステージ達成、おめでとうございます！'), para(text)];
    if (reward.benefit) nodes.push(para(reward.benefit));
    const img = safeUrl(reward.imageUrl);
    if (img) { const im = new Image(); im.alt = reward.title || '全ステージ達成特典'; im.referrerPolicy = 'no-referrer'; im.src = img.href; nodes.push(im); }
    const buttons = [];
    const redeem = reward.status === 'ISSUED' && safeUrl(reward.redeemUrl);
    if (redeem) buttons.push({ label: 'GameBullでギフト券を開く', primary: true, run: () => {
      // Inside the app the frame has no allow-popups: close the game and let the app open the coupon
      // (gamebull-whitelabel d85807c honours to: /coupons/<id>). Outside the app, open the wallet link.
      const m = /^\/coupons\/[^/?#]+$/.exec(redeem.pathname);
      if (closeToGameBull(m ? m[0] : undefined)) return;
      const a = document.createElement('a'); a.href = redeem.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click();
    } });
    buttons.push({ label: '閉じる', primary: !redeem });
    showDialog(nodes, buttons);
  }

  /* ── GameBull app corners: in its expanded view (its "max" button, and landscape) the app draws Done (top left) and
   * a collapse button (top right) over the game frame (gamebull-whitelabel game-overlay-controls.tsx ImmersiveControls:
   * 44 px tall, 4 px in; Done about 62 px wide). loader.ts infers the view from the frame's size changes and sets
   * window.KZ_APP_CORNERS (PHOTO JIGSAW build 5). Their header's 黒墨商店 seal (top left) would sit under Done: it moves
   * right of it; their 目次 / ♪ / ? buttons are already below the collapse button; their dialogs stay below both. ── */
  const fitStyle = document.createElement('style'); fitStyle.id = 'kzgb-fit'; document.head.appendChild(fitStyle);
  const APP_TOP = 54, APP_LEFT = 76; // Done is 4 + ~62 px wide; their seal is turned -5deg (its box is ~2 px wider)
  const frameScale = () => { try { const f = window.frameElement; return f && f.offsetWidth ? f.getBoundingClientRect().width / f.offsetWidth || 1 : 1; } catch { return 1; } };
  let lastFit = '';
  function KZFit() {
    let rule = '';
    if (window.KZ_APP_CORNERS === true) {
      const k = frameScale(), top = Math.ceil(APP_TOP / k), left = Math.ceil(APP_LEFT / k);
      fitStyle.textContent = '';
      const brand = document.querySelector('body > header .brand').getBoundingClientRect();
      const shift = Math.max(0, Math.ceil(left - brand.left));
      rule = `body>header .brand{transform:translateX(${shift}px)}
        dialog{max-height:calc(100dvh - ${top * 2 + 8}px)!important}`;
    }
    fitStyle.textContent = rule;
    if (rule !== lastFit) { lastFit = rule; log(`Fit ${innerWidth}x${innerHeight}: ${rule ? 'app corners kept clear' : 'their layout'}.`); }
  }
  window.KZFit = KZFit;
  addEventListener('resize', KZFit);
  KZFit();

  /* ── start-up: GameBull's progress first; a launch that cannot play says so ── */
  const progress = p => { try { window.parent.gbLoaderProgress && window.parent.gbLoaderProgress(p); } catch { /* not in our frame */ } };
  let signalled = false, pageLoaded = document.readyState === 'complete', checked = false;
  const done = () => { if (signalled) return; signalled = true; KZFit(); progress(1); try { window.parent.gbLoaderDone && window.parent.gbLoaderDone(); } catch { /* not in our frame */ } };
  const maybeDone = () => { if (pageLoaded && checked) done(); };
  if (!pageLoaded) addEventListener('load', () => { pageLoaded = true; progress(0.6); maybeDone(); }, { once: true });
  setTimeout(done, 15000); // never keep the loading page up on an answer that will not come
  progress(0.3);
  gb().check().then(c => { log(`Progress ${c.stageMode.highestCleared} / 600, ${gb().lives} Lives.`); return gb().settlePendingClears().catch(() => { /* sent again before the next start */ }); })
    .catch(e => {
      log('Start-up message: ' + e.message);
      showLives();
      if (e.code === 'network') return; // their ゲームスタート tries again
      const buttons = gb().embedded ? [{ label: 'GameBullに戻る', primary: true, run: () => closeToGameBull() }, { label: '閉じる' }] : [{ label: 'OK', primary: true }];
      showDialog([para(e.message)], buttons);
    })
    .finally(() => { checked = true; maybeDone(); });

  /* ── sound ──
   * iPhone: Web Audio plays with the silent switch on (trap W2), and only a touchend / pointerup / click / keydown
   * counts as a tap for audio (their page unlocks on pointerdown, which iPhone does not count): their own unlock()
   * runs on those too (it does nothing when the player has turned their sound off).
   * Their music from the first tap anywhere, also on their title (PHOTO JIGSAW QA: "music should not be off by
   * default"): their page keeps it paused while the title shows (their 'title' reason, and their pause of the game
   * board under it); both are left out, so their title plays their BGM once the first tap has unlocked it. Their pause
   * button, hidden tab and audio settings work as theirs. */
  document.addEventListener('pointerdown', () => { try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* n/a */ } }, { capture: true, once: true });
  const unlockOnTap = e => { if (e.isTrusted && !(e.target && e.target.closest && e.target.closest('#audioDialog,#sound'))) { try { NightAudio.unlock(); } catch { /* their audio */ } } };
  for (const t of ['pointerup', 'touchend']) document.addEventListener(t, unlockOnTap, { capture: true });
  const theirSetPaused = NightAudio.setPaused;
  NightAudio.setPaused = function (reason, on) { if (reason === 'title') return; return theirSetPaused.apply(this, arguments); };
  theirSetPaused.call(NightAudio, 'title', false);
  const theirShowTitle = showTitle;
  showTitle = function () { theirShowTitle.apply(this, arguments); theirSetPaused.call(NightAudio, 'game', false); };
})();
