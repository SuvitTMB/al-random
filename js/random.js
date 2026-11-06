/**
 * AL Drive Forum Special - Random / Registration & Lucky Draw Display Logic
 * Real-time synchronization with Firestore (AL_Employee & AL_Reward), BroadcastChannel, and localStorage.
 */

(function () {
  'use strict';

  // ลบรายการของรางวัลจำลองออกทั้งหมด เพื่อไม่ให้ปนในตารางใช้งานจริง
  const DEFAULT_REWARDS = [];

  const REWARD_GROUPS = [
    'Group-1', 'Group-2', 'Group-3', 'Group-4', 'Group-5',
    'Group-6', 'Group-7', 'Group-8', 'Group-9', 'Group Extra'
  ];

  function compareRewardGroups(a, b) {
    const parseGrp = (g) => {
      if (!g) return 999;
      const str = String(g).trim();
      if (/extra/i.test(str)) return 10;
      const m = str.match(/Group-(\d+)/i);
      if (m) return parseInt(m[1], 10);
      const mAny = str.match(/\d+/);
      if (mAny) return parseInt(mAny[0], 10);
      return 999;
    };
    const numA = parseGrp(a && a.group);
    const numB = parseGrp(b && b.group);
    if (numA !== numB) return numA - numB;
    const grpA = String((a && a.group) || '').trim();
    const grpB = String((b && b.group) || '').trim();
    const comp = grpA.localeCompare(grpB, undefined, { numeric: true, sensitivity: 'base' });
    if (comp !== 0) return comp;
    return (Number(a.order) || 0) - (Number(b.order) || 0);
  }

  const state = {
    employees: [],
    rewards: [],
    collectionName: (window.DB_PATHS && window.DB_PATHS.AL_EMPLOYEE) || 'AL_Employee',
    rewardsCollection: (window.DB_PATHS && window.DB_PATHS.AL_REWARD) || 'AL_Reward',
    controlCollection: 'AL_Reward', // ใช้ AL_Reward แทน AL_Control เพื่อรองรับ Firebase Security Rules
    roomPin: (function() {
      try {
        return localStorage.getItem('AL_ROOM_PIN') || 'AL2026';
      } catch (e) {
        return 'AL2026';
      }
    })(),
    heartbeatTimer: null,
    lastRegisteredCount: 0,
    db: null,
    unsubscribeSnapshot: null,
    unsubscribeRewardsSnapshot: null,
    unsubscribeControlSnapshot: null,
    activeView: 'reg',
    isRouletteRunning: false,
    latestWinnerId: null,
    drawMode: 'normal',
    drawCategory: 'group',
    filterPrizeGroup: 'ALL',
    selectedExtraRewardId: null,
    isExtraDrawRunning: false,
    clientId: 'cli_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    lastHandledEventId: null
  };

  // DOM Elements
  const viewRegistration = document.getElementById('viewRegistration');
  const viewLuckyDraw = document.getElementById('viewLuckyDraw');
  const btnGoToDraw = document.getElementById('btnGoToDraw');
  const btnBackToReg = document.getElementById('btnBackToReg');
  const btnModeGroup = document.getElementById('btnModeGroup');
  const btnModeIndividual = document.getElementById('btnModeIndividual');
  const drawCategoryPill = document.getElementById('drawCategoryPill');
  const prizesGrid2x3 = document.getElementById('prizesGrid2x3');
  const groupExtraStageWrap = document.getElementById('groupExtraStageWrap');
  const grandDrawTriggerRow = document.getElementById('grandDrawTriggerRow');
  const drawEligiblePill = document.getElementById('drawEligiblePill');

  const elRegCount = document.getElementById('statRegisteredCount');
  const elRegPercent = document.getElementById('statPercentValue');
  const elProgressBar = document.getElementById('statProgressBar');
  const elRatioText = document.getElementById('statRatioText');
  const elConnStatus = document.getElementById('connStatusIndicator');
  const btnFullscreen = document.getElementById('btnToggleFullscreen');

  // Grand Draw Lightbox Modal Elements (ขนาดกว้าง 80%)
  const btnOpenGrandDrawModal = document.getElementById('btnOpenGrandDrawModal');
  const btnOpenFastDrawModal = document.getElementById('btnOpenFastDrawModal');
  const grandDrawModal = document.getElementById('grandDrawModal');
  const grandModalHeadline = document.getElementById('grandModalHeadline');
  const btnCloseGrandModal = document.getElementById('btnCloseGrandModal');
  const grandPrizesListContainer = document.getElementById('grandPrizesListContainer');
  const modalEligibleCountPill = document.getElementById('modalEligibleCountPill');
  const modalTotalQuotaPill = document.getElementById('modalTotalQuotaPill');
  const modalDrawnCountPill = document.getElementById('modalDrawnCountPill');
  const btnExecuteAllDraw = document.getElementById('btnExecuteAllDraw');
  const btnExecuteAllText = document.getElementById('btnExecuteAllText');
  const grandDrawLiveTicker = document.getElementById('grandDrawLiveTicker');
  const grandDrawLiveText = document.getElementById('grandDrawLiveText');

  // Prize Detail Lightbox Modal Elements (คลิกที่รูปภาพของรางวัล)
  const prizeDetailModal = document.getElementById('prizeDetailModal');
  const btnClosePrizeDetail = document.getElementById('btnClosePrizeDetail');
  const detailModalImg = document.getElementById('detailModalImg');
  const detailModalOrderBadge = document.getElementById('detailModalOrderBadge');
  const detailModalTitle = document.getElementById('detailModalTitle');
  const detailModalQtyPill = document.getElementById('detailModalQtyPill');
  const detailModalRemainPill = document.getElementById('detailModalRemainPill');
  const detailModalWinnersList = document.getElementById('detailModalWinnersList');

  // QR Code Lightbox Modal Elements (คลิกเพื่อขยายภาพให้ใหญ่ขึ้น)
  const qrLightboxModal = document.getElementById('qrLightboxModal');
  const btnCloseQrLightbox = document.getElementById('btnCloseQrLightbox');
  const qrLightboxBadgeText = document.getElementById('qrLightboxBadgeText');
  const qrLightboxImg = document.getElementById('qrLightboxImg');
  const qrLightboxTitle = document.getElementById('qrLightboxTitle');
  const qrLightboxDesc = document.getElementById('qrLightboxDesc');
  const qrFrameView1 = document.getElementById('qrFrameView1');
  const qrImageView1 = document.getElementById('qrImageView1');
  const grandQrFrame = document.getElementById('grandQrFrame');
  const grandQrImg = document.getElementById('grandQrImg');

  // Draw Roulette Modal Elements (สุ่มผู้โชคดีหมุนเวียนทีละรางวัล)
  const drawRouletteModal = document.getElementById('drawRouletteModal');
  const btnCloseRoulette = document.getElementById('btnCloseRoulette');
  const roulettePrizeBadge = document.getElementById('roulettePrizeBadge');
  const roulettePrizeThumb = document.getElementById('roulettePrizeThumb');
  const roulettePrizeTitle = document.getElementById('roulettePrizeTitle');
  const rouletteStageRolling = document.getElementById('rouletteStageRolling');
  const rollingEmpId = document.getElementById('rollingEmpId');
  const rollingEmpName = document.getElementById('rollingEmpName');
  const rollingEmpInfo = document.getElementById('rollingEmpInfo');
  const rouletteStageWinner = document.getElementById('rouletteStageWinner');
  const winnerHeroId = document.getElementById('winnerHeroId');
  const winnerHeroName = document.getElementById('winnerHeroName');
  const winnerHeroDetails = document.getElementById('winnerHeroDetails');
  const winnerFlyHint = document.getElementById('winnerFlyHint');

  // Winner Claim Modal Elements (คลิกกล่องชื่อเพื่อดูข้อมูลและยืนยันการรับรางวัล)
  const winnerClaimModal = document.getElementById('winnerClaimModal');
  const btnCloseWinnerClaim = document.getElementById('btnCloseWinnerClaim');
  const claimModalPrizeImgWrap = document.getElementById('claimModalPrizeImgWrap');
  const claimModalPrizeOrder = document.getElementById('claimModalPrizeOrder');
  const claimModalPrizeName = document.getElementById('claimModalPrizeName');
  const claimModalStatusPill = document.getElementById('claimModalStatusPill');
  const claimModalStatusText = document.getElementById('claimModalStatusText');
  const claimModalEmpId = document.getElementById('claimModalEmpId');
  const claimModalEmpName = document.getElementById('claimModalEmpName');
  const claimModalEmpGroup = document.getElementById('claimModalEmpGroup');
  const claimModalEmpMember = document.getElementById('claimModalEmpMember');
  const claimModalEmpBranch = document.getElementById('claimModalEmpBranch');
  const claimModalDrawTime = document.getElementById('claimModalDrawTime');
  const claimModalClaimedRow = document.getElementById('claimModalClaimedRow');
  const claimModalClaimedTime = document.getElementById('claimModalClaimedTime');
  const btnConfirmClaim = document.getElementById('btnConfirmClaim');
  const btnConfirmClaimText = document.getElementById('btnConfirmClaimText');
  const btnCancelClaimStatus = document.getElementById('btnCancelClaimStatus');
  const claimNoticeHint = document.getElementById('claimNoticeHint');

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    initViewNavigation();
    initFullscreenToggle();
    initGrandDrawModal();
    initQrLightboxModal();
    initRouletteModal();
    initPrizeDetailModal();
    initWinnerClaimModal();
    initExtraRedrawModal();
    initLocalFallback();
    initDrawButtonsSettings();
    renderRewardGroupsGrid();
    renderDrawGroupsFilterBar();
    initRealtimeListeners();
    initFirebaseService();
  });

  // ===========================================================================
  // VIEW NAVIGATION (Switch between Registration & Lucky Draw Stage)
  // ===========================================================================
  function setDrawCategory(cat) {
    state.drawCategory = cat;
    if (btnModeGroup) {
      btnModeGroup.classList.toggle('active', cat === 'group');
    }
    if (btnModeIndividual) {
      btnModeIndividual.classList.toggle('active', cat === 'individual');
    }
    if (drawCategoryPill) {
      drawCategoryPill.textContent = cat === 'group' ? '👥 แบบกลุ่ม' : '👤 รายบุคคล';
    }
  }

  function initViewNavigation() {
    if (btnModeGroup) {
      btnModeGroup.addEventListener('click', () => {
        setDrawCategory('group');
      });
    }

    if (btnModeIndividual) {
      btnModeIndividual.addEventListener('click', () => {
        setDrawCategory('individual');
      });
    }

    if (btnGoToDraw) {
      btnGoToDraw.addEventListener('click', (e) => {
        e.preventDefault();
        showView('draw');
      });
    }

    if (btnBackToReg) {
      btnBackToReg.addEventListener('click', (e) => {
        e.preventDefault();
        showView('reg');
      });
    }

    // Hash Navigation Check
    window.addEventListener('hashchange', checkUrlHash);
    checkUrlHash();
  }

  function checkUrlHash() {
    const hash = window.location.hash.toLowerCase();
    if (hash === '#draw' || hash === '#luckydraw') {
      showView('draw', false);
    } else {
      showView('reg', false);
    }
  }

  function showView(viewName, updateHash = true) {
    state.activeView = viewName;

    if (viewName === 'draw') {
      if (viewRegistration) {
        viewRegistration.style.display = 'none';
        viewRegistration.classList.remove('active');
      }
      if (viewLuckyDraw) {
        viewLuckyDraw.style.display = 'block';
        viewLuckyDraw.classList.add('active');
      }
      document.body.classList.add('in-draw-view');
      if (updateHash && window.location.hash !== '#draw') {
        window.location.hash = 'draw';
      }
      renderPrizesGrid();
      renderDrawGroupsFilterBar();
      updateEligiblePill();
    } else {
      renderRewardGroupsGrid();
      if (viewLuckyDraw) {
        viewLuckyDraw.style.display = 'none';
        viewLuckyDraw.classList.remove('active');
      }
      if (viewRegistration) {
        viewRegistration.style.display = 'block';
        viewRegistration.classList.add('active');
      }
      document.body.classList.remove('in-draw-view');
      if (updateHash && window.location.hash === '#draw') {
        history.replaceState(null, null, ' ');
      }
      updateDisplay(false);
    }
  }

  // Escape HTML helper
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ===========================================================================
  // DATA CALCULATION & REGISTRATION UI UPDATE
  // ===========================================================================
  function hasEmpNameText(empName) {
    if (empName === undefined || empName === null) return false;
    const s = String(empName).trim();
    return s !== '' && s !== '-' && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined';
  }

  // ผู้มีสิทธิ์ลุ้นรางวัล: ตรวจสอบฟิวด์ Member ไม่ใช่ค่าว่าง หรือค่า null
  function isMemberEligible(emp) {
    if (!emp) return false;
    const m = emp.Member;
    if (m === undefined || m === null) return false;
    const s = String(m).trim();
    return s !== '' && s !== '-' && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined';
  }

  function getTotalRemainingPrizes() {
    const activeGroups = getActiveRewardGroups();
    return activeGroups.reduce((acc, g) => acc + (Number(g.remainQty) || 0), 0);
  }

  function updateDisplay(animate = true) {
    // 1. การแสดงผลจำนวนผู้มีสิทธิ์ลุ้นรางวัล: ตรวจสอบเฉพาะผู้ที่ยังมีสิทธิ์ (ยังไม่ได้รับรางวัล)
    const eligibleCandidates = getEligibleCandidates();
    const eligibleCount = eligibleCandidates.length;

    // 2. จำนวนรางวัลคงเหลือทั้งหมดในระบบ
    const totalRemainPrizes = getTotalRemainingPrizes();

    // 3. จำนวนพนักงานทั้งหมดในระบบ
    const namedEmployees = state.employees.filter(e => hasEmpNameText(e.EmpName));
    const total = state.employees.length > 0 ? state.employees.length : namedEmployees.length;

    // 4. คำนวณหา % สัดส่วนผู้มีสิทธิ์ลุ้นรางวัล
    const percent = total > 0 ? ((eligibleCount / total) * 100).toFixed(1) : '0.0';

    // อัปเดตกล่องซ้ายมือ: จำนวนผู้มีสิทธิ์ลุ้นรางวัล (ไม่นับรวมผู้ที่ได้รางวัลแล้ว)
    if (elRegCount) {
      if (animate && state.lastRegisteredCount !== eligibleCount) {
        animateCounter(elRegCount, state.lastRegisteredCount, eligibleCount, 800);
        elRegCount.classList.add('pulse-tick');
        setTimeout(() => elRegCount.classList.remove('pulse-tick'), 300);

        if (eligibleCount > state.lastRegisteredCount && state.lastRegisteredCount > 0) {
          triggerSparkleCelebration();
        }
      } else {
        elRegCount.textContent = eligibleCount.toLocaleString();
      }
    }
    state.lastRegisteredCount = eligibleCount;

    // อัปเดตกล่องซ้ายมือ: จำนวนรางวัลคงเหลือ
    const elRemainPrizes = document.getElementById('statRemainPrizesCount');
    if (elRemainPrizes) {
      if (animate && state.lastRemainPrizes !== undefined && state.lastRemainPrizes !== totalRemainPrizes) {
        animateCounter(elRemainPrizes, state.lastRemainPrizes, totalRemainPrizes, 800);
        elRemainPrizes.classList.add('pulse-tick');
        setTimeout(() => elRemainPrizes.classList.remove('pulse-tick'), 300);
      } else {
        elRemainPrizes.textContent = totalRemainPrizes.toLocaleString();
      }
    }
    state.lastRemainPrizes = totalRemainPrizes;

    if (elRegPercent) {
      elRegPercent.textContent = `${percent}%`;
    }

    if (elProgressBar) {
      const clampedPercent = Math.min(Math.max(parseFloat(percent), 0), 100);
      elProgressBar.style.width = `${clampedPercent}%`;
    }

    if (elRatioText) {
      elRatioText.textContent = `${eligibleCount.toLocaleString()} จากทั้งหมด ${total.toLocaleString()} คน`;
    }

    // อัปเดตกล่องเลือกการสุ่มของรางวัลตาม Group ให้สรุปจำนวนของรางวัลและที่สุ่มไปแล้วแบบเรียลไทม์
    renderRewardGroupsGrid();

    // Also update lucky draw grid & pill if in draw view
    if (state.activeView === 'draw') {
      renderPrizesGrid();
      updateEligiblePill();
    }
  }

  function animateCounter(element, start, end, duration) {
    if (start === end) {
      element.textContent = end.toLocaleString();
      return;
    }
    const range = end - start;
    const startTime = performance.now();

    function step(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(start + range * easeOut);
      element.textContent = current.toLocaleString();

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        element.textContent = end.toLocaleString();
      }
    }
    requestAnimationFrame(step);
  }

  function triggerSparkleCelebration() {
    if (typeof confetti === 'function') {
      try {
        confetti({
          particleCount: 50,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#00d2ff', '#10b981', '#ff8b00', '#ffffff']
        });
      } catch (e) {}
    }
  }

  // ===========================================================================
  // CELEBRATION FIREWORKS & DRAW SOUND EFFECTS (Web Audio API Synthesizer)
  // ===========================================================================
  let celebrationAudioCtx = null;

  function getCelebrationAudioContext() {
    try {
      if (!celebrationAudioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          celebrationAudioCtx = new AudioCtx();
        }
      }
      if (celebrationAudioCtx && celebrationAudioCtx.state === 'suspended') {
        celebrationAudioCtx.resume().catch(() => {});
      }
    } catch (e) {}
    return celebrationAudioCtx;
  }

  function checkAndPromptAudioUnlock() {
    const ctx = getCelebrationAudioContext();
    const banner = document.getElementById('audioUnlockBanner');
    if (!ctx || ctx.state === 'suspended') {
      if (banner) banner.style.display = 'flex';
      updateAudioButtonUI();
    } else {
      if (banner) banner.style.display = 'none';
      updateAudioButtonUI();
    }
  }

  function unlockAudioContext() {
    try {
      const ctx = getCelebrationAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().then(() => {
          updateAudioButtonUI();
          const banner = document.getElementById('audioUnlockBanner');
          if (banner) banner.style.display = 'none';
        }).catch(() => {
          const banner = document.getElementById('audioUnlockBanner');
          if (banner) banner.style.display = 'flex';
        });
      } else {
        updateAudioButtonUI();
        const banner = document.getElementById('audioUnlockBanner');
        if (banner) banner.style.display = 'none';
      }
    } catch (e) {}
  }

  function updateAudioButtonUI() {
    const btn = document.getElementById('btnToggleAudio');
    const icon = document.getElementById('audioIcon');
    const text = document.getElementById('audioText');
    if (!btn) return;
    if (celebrationAudioCtx && celebrationAudioCtx.state === 'running') {
      if (icon) icon.textContent = '🔊';
      if (text) text.textContent = 'เสียงเปิด';
      btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      btn.style.color = '#34d399';
    } else {
      if (icon) icon.textContent = '🔇';
      if (text) text.textContent = 'คลิกเปิดเสียง';
      btn.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      btn.style.color = '#fbbf24';
    }
  }

  window.unlockOrToggleAudio = function() {
    const ctx = getCelebrationAudioContext();
    if (ctx) {
      ctx.resume().then(() => {
        playPopChime();
        updateAudioButtonUI();
        const banner = document.getElementById('audioUnlockBanner');
        if (banner) banner.style.display = 'none';
      }).catch(() => {});
    }
  };

  // ปลดล็อคเสียงอัตโนมัติเมื่อมีการสัมผัสหรือคลิกบนหน้าจอ
  ['click', 'touchstart', 'touchend', 'keydown', 'pointerdown'].forEach(ev => {
    window.addEventListener(ev, () => {
      unlockAudioContext();
    }, { passive: true, once: false });
  });

  setTimeout(checkAndPromptAudioUnlock, 600);

  // เสียง Tick กลไกขณะตัวเลขหรือรายชื่อกำลังหมุนสุ่ม
  function playTickSound() {
    try {
      const ctx = getCelebrationAudioContext();
      if (!ctx || ctx.state !== 'running') return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(650 + Math.random() * 250, ctx.currentTime);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.035);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.04);
    } catch (e) {}
  }

  // เสียงดนตรี Fanfare ชัยชนะเมื่อเปิดเผยผู้ชนะรางวัล
  function playWinnerFanfare() {
    try {
      const ctx = getCelebrationAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const now = ctx.currentTime;
      const notes = [
        { f: 392.00, t: 0.00, d: 0.12 }, // G4
        { f: 523.25, t: 0.08, d: 0.12 }, // C5
        { f: 659.25, t: 0.16, d: 0.14 }, // E5
        { f: 783.99, t: 0.24, d: 0.45 }  // G5
      ];
      notes.forEach(n => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n.f, now + n.t);
        gain.gain.setValueAtTime(0.001, now + n.t);
        gain.gain.linearRampToValueAtTime(0.2, now + n.t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + n.t + n.d);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + n.t);
        osc.stop(now + n.t + n.d + 0.02);
      });
    } catch (e) {}
  }

  function playCelebrationFireworksAudio() {
    try {
      const ctx = getCelebrationAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      // Staggered firework explosions matching visual confetti
      const bursts = [
        { time: now + 0.05, pitch: 95,  volume: 0.9 },
        { time: now + 0.45, pitch: 125, volume: 1.0 },
        { time: now + 1.10, pitch: 85,  volume: 0.85 },
        { time: now + 1.60, pitch: 135, volume: 1.0 },
        { time: now + 2.25, pitch: 105, volume: 0.85 }
      ];

      bursts.forEach(b => {
        playSingleFirework(ctx, b.time, b.pitch, b.volume);
      });

      // Celebratory victory chimes chord
      playVictoryChimes(ctx, now + 0.25);
    } catch (err) {
      console.warn("Fireworks audio error:", err);
    }
  }

  function playSingleFirework(ctx, startTime, baseFreq, masterVol) {
    try {
      // 1. Whistle rocket launch
      const whistleOsc = ctx.createOscillator();
      const whistleGain = ctx.createGain();
      whistleOsc.type = 'triangle';
      whistleOsc.frequency.setValueAtTime(320, startTime);
      whistleOsc.frequency.exponentialRampToValueAtTime(1150, startTime + 0.28);

      whistleGain.gain.setValueAtTime(0.001, startTime);
      whistleGain.gain.linearRampToValueAtTime(0.25 * masterVol, startTime + 0.15);
      whistleGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);

      whistleOsc.connect(whistleGain);
      whistleGain.connect(ctx.destination);
      whistleOsc.start(startTime);
      whistleOsc.stop(startTime + 0.32);

      // 2. Deep Boom Explosion
      const boomTime = startTime + 0.28;
      const boomOsc = ctx.createOscillator();
      const boomGain = ctx.createGain();
      boomOsc.type = 'sine';
      boomOsc.frequency.setValueAtTime(baseFreq, boomTime);
      boomOsc.frequency.exponentialRampToValueAtTime(28, boomTime + 0.6);

      boomGain.gain.setValueAtTime(0.75 * masterVol, boomTime);
      boomGain.gain.exponentialRampToValueAtTime(0.001, boomTime + 0.8);

      boomOsc.connect(boomGain);
      boomGain.connect(ctx.destination);
      boomOsc.start(boomTime);
      boomOsc.stop(boomTime + 0.85);

      // 3. Noise Rumble & Impact
      const bufferSize = Math.floor(ctx.sampleRate * 0.7);
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.setValueAtTime(260, boomTime);
      noiseFilter.frequency.exponentialRampToValueAtTime(45, boomTime + 0.7);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.85 * masterVol, boomTime);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, boomTime + 0.7);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noise.start(boomTime);
      noise.stop(boomTime + 0.75);

      // 4. Crackles / Sparkles
      const crackleCount = 10;
      for (let k = 0; k < crackleCount; k++) {
        const crackleTime = boomTime + 0.25 + (Math.random() * 0.65);
        const crackleOsc = ctx.createOscillator();
        const crackleGain = ctx.createGain();
        crackleOsc.type = 'square';
        crackleOsc.frequency.setValueAtTime(1200 + Math.random() * 1800, crackleTime);

        crackleGain.gain.setValueAtTime(0.08 * masterVol, crackleTime);
        crackleGain.gain.exponentialRampToValueAtTime(0.001, crackleTime + 0.04);

        crackleOsc.connect(crackleGain);
        crackleGain.connect(ctx.destination);
        crackleOsc.start(crackleTime);
        crackleOsc.stop(crackleTime + 0.05);
      }
    } catch (e) {}
  }

  function playVictoryChimes(ctx, startTime) {
    try {
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const noteTime = startTime + idx * 0.12;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, noteTime);

        gain.gain.setValueAtTime(0.001, noteTime);
        gain.gain.linearRampToValueAtTime(0.18, noteTime + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.7);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(noteTime);
        osc.stop(noteTime + 0.75);
      });
    } catch (e) {}
  }

  function playPopChime() {
    try {
      const ctx = getCelebrationAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(784, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1318.5, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.17);
    } catch (e) {}
  }

  // Grand Fireworks Celebration เมื่อสิ้นสุดการสุ่มรางวัลทั้งหมด
  function triggerGrandCelebrationFireworks() {
    // เล่นเสียงพุแสดงความยินดี
    playCelebrationFireworksAudio();

    if (typeof confetti !== 'function') return;
    try {
      const duration = 4000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 35, spread: 360, ticks: 70, zIndex: 99999 };

      function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
      }

      const interval = setInterval(function() {
        const timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) {
          return clearInterval(interval);
        }
        const particleCount = Math.floor(60 * (timeLeft / duration));
        // Fire from left side
        confetti(Object.assign({}, defaults, {
          particleCount,
          origin: { x: randomInRange(0.1, 0.35), y: Math.random() - 0.2 },
          colors: ['#00d2ff', '#10b981', '#fbbf24', '#f43f5e', '#ffffff']
        }));
        // Fire from right side
        confetti(Object.assign({}, defaults, {
          particleCount,
          origin: { x: randomInRange(0.65, 0.9), y: Math.random() - 0.2 },
          colors: ['#00d2ff', '#10b981', '#fbbf24', '#f43f5e', '#ffffff']
        }));
      }, 250);

      // Center explosion
      setTimeout(() => {
        confetti({
          particleCount: 130,
          spread: 120,
          origin: { y: 0.55 },
          colors: ['#00d2ff', '#10b981', '#fbbf24', '#ffffff', '#ec4899']
        });
      }, 400);

      setTimeout(() => {
        confetti({
          particleCount: 150,
          spread: 150,
          origin: { y: 0.5 },
          colors: ['#00d2ff', '#10b981', '#fbbf24', '#ffffff']
        });
      }, 1500);
    } catch (err) {
      console.warn("Fireworks error:", err);
    }
  }

  // ===========================================================================
  // LUCKY DRAW CANDIDATES & CONDITIONS
  // ===========================================================================
  // เงื่อนไขผู้มีสิทธิ์ลุ้นรางวัล:
  // 1. ตรวจสอบฟิวด์ Member ไม่ใช่ค่าว่าง หรือค่า null (isMemberEligible === true)
  // 2. ฟิลด์ EmpName ไม่เท่ากับ - หรือค่าว่าง หรือค่า null ทั้งหมด (hasEmpNameText === true)
  // 3. ยังไม่เคยได้รับรางวัลมาก่อนหน้านี้
  function getEligibleCandidates() {
    return state.employees.filter(emp => {
      // 1. ตรวจสอบฟิวด์ Member ไม่ใช่ค่าว่าง หรือค่า null
      if (!isMemberEligible(emp)) return false;
      // 2. ฟิลด์ EmpName ไม่เท่ากับ - หรือค่าว่าง หรือค่า null
      if (!hasEmpNameText(emp.EmpName)) return false;
      // 3. ยังไม่เคยได้รับรางวัลมาก่อนหน้านี้
      if (emp.RewardName && emp.RewardName !== '-' && String(emp.RewardName).trim() !== '') return false;
      return true;
    });
  }

  function updateEligiblePill() {
    if (!drawEligiblePill) return;
    const eligibleCount = getEligibleCandidates().length;
    drawEligiblePill.textContent = `ผู้มีสิทธิ์: ${eligibleCount.toLocaleString()} คน`;
  }

  // ===========================================================================
  // 2x3 PRIZES GRID RENDERING (2 แถว แถวละ 3 ช่อง ความกว้าง-สูงเท่ากัน)
  // ===========================================================================
  
  // ===========================================================================
  // GROUP-BASED DRAW SELECTION & FILTER BAR
  // ===========================================================================
  window.goToDrawByGroup = function(grp, isBroadcast = true) {
    const activeGroups = getActiveRewardGroups();
    const targetGroup = grp || (activeGroups.length > 0 ? activeGroups[0].group : 'Group-1');
    state.filterPrizeGroup = targetGroup;
    state.drawCategory = 'group';
    showView('draw');
    renderPrizesGrid();
    renderDrawGroupsFilterBar();
    if (drawCategoryPill) {
      const cur = activeGroups.find(g => g.group === targetGroup);
      const displayTitle = (cur && cur.groupName && cur.groupName.trim() !== '') ? cur.groupName.trim() : targetGroup;
      drawCategoryPill.textContent = `🎯 ${displayTitle}`;
    }
    if (isBroadcast) {
      broadcastLiveDrawEvent({
        type: 'GROUP_SELECT',
        group: targetGroup
      });
    }
  };

  /**
   * ดึงรายชื่อผู้โชคดีสำหรับของรางวัลปกติแต่ละกล่อง (รองรับกรณีชื่อรางวัลซ้ำกัน)
   * โดยตรวจสอบจาก RewardId ก่อน หากไม่มีให้กระจายผู้โชคดีตามลำดับกล่องโดยไม่ให้เกินจำนวน quota (quantity) ของแต่ละกล่อง
   */
  function getWinnersForDisplayReward(reward, rewardIdx, allDisplayRewards) {
    if (!reward) return [];
    const rId = String(reward.id || '').trim();
    const cleanName = String(reward.name || '').trim().toLowerCase();
    const qty = Math.max(1, parseInt(reward.quantity, 10) || 1);
    const list = Array.isArray(allDisplayRewards) && allDisplayRewards.length > 0 ? allDisplayRewards : getDisplayRewards();

    // หากเป็น Group Extra ให้ใช้ getWinnersForExtraReward
    if (reward.group === 'Group Extra') {
      return getWinnersForExtraReward(reward, list);
    }

    // 1. ค้นหาผู้ที่ผูกกับ RewardId นี้โดยตรง (ถ้ามี)
    if (rId !== '') {
      const directMatches = state.employees.filter(e => {
        if (!e || !e.RewardName) return false;
        return String(e.RewardId || '').trim() === rId;
      });
      if (directMatches.length > 0) {
        return directMatches.slice(0, qty);
      }
    }

    // 2. หากยังไม่มี RewardId หรือเป็นข้อมูลเดิม (Legacy):
    // ให้ค้นหากล่องรางวัลทั้งหมดในหน้านี้ที่ใช้ชื่อรางวัลเดียวกัน
    const sameNameRewards = list.filter(r => {
      return r && String(r.name || '').trim().toLowerCase() === cleanName && r.group !== 'Group Extra';
    });

    // ดึงผู้ที่ได้รางวัลชื่อนี้ทั้งหมด
    const allWinnersForName = state.employees.filter(e => {
      if (!e || !e.RewardName) return false;
      if (e.RewardGroup === 'Group Extra') return false;
      return String(e.RewardName).trim().toLowerCase() === cleanName;
    });

    // จัดเรียงลำดับผู้โชคดีตาม RewardDrawTime หรือ EmployeeID
    allWinnersForName.sort((a, b) => {
      const tA = a.RewardDrawTime || a.RewardTime || '';
      const tB = b.RewardDrawTime || b.RewardTime || '';
      if (tA && tB && tA !== tB) return tA.localeCompare(tB);
      return String(a.EmployeeID).localeCompare(String(b.EmployeeID));
    });

    // หากมีกล่องเดียวที่ใช้ชื่อนี้
    if (sameNameRewards.length <= 1) {
      const result = allWinnersForName.slice(0, qty);
      if (rId !== '') {
        result.forEach(w => {
          if (!w.RewardId || w.RewardId === '') {
            w.RewardId = rId;
            w.RewardOrder = reward.order || (rewardIdx !== undefined ? rewardIdx + 1 : 1);
            w.RewardGroup = reward.group || '';
          }
        });
      }
      return result;
    }

    // หากมีหลายกล่องที่ใช้ชื่อเดียวกัน (เช่น ttb broker 3 กล่อง กล่องละ 5 รางวัล):
    // คำนวณ offset ตามจำนวน quota ของกล่องก่อนหน้า
    let startIndex = 0;
    for (const otherR of sameNameRewards) {
      if (otherR === reward || (otherR.id && otherR.id === reward.id) || (otherR.order && otherR.order === reward.order)) {
        break;
      }
      startIndex += (Math.max(1, parseInt(otherR.quantity, 10) || 1));
    }

    const assignedWinners = allWinnersForName.slice(startIndex, startIndex + qty);

    // Auto-patch RewardId in state.employees if missing so it stays permanently linked
    if (rId !== '') {
      assignedWinners.forEach(w => {
        if (!w.RewardId || w.RewardId === '') {
          w.RewardId = rId;
          w.RewardOrder = reward.order || (rewardIdx !== undefined ? rewardIdx + 1 : 1);
          w.RewardGroup = reward.group || '';
          if (state.db) {
            const docId = w.id || String(w.EmployeeID);
            state.db.collection(state.collectionName).doc(docId).set({
              RewardId: rId,
              RewardOrder: reward.order || (rewardIdx !== undefined ? rewardIdx + 1 : 1),
              RewardGroup: reward.group || ''
            }, { merge: true }).catch(() => {});
          }
        }
      });
    }

    return assignedWinners;
  }

  /**
   * ค้นหาผู้ได้รับรางวัลสำหรับของรางวัลในกลุ่ม Group Extra
   * เนื่องจากใน Group Extra รางวัลอาจมีชื่อเดียวกัน (เช่น "รางวัลพิเศษ") แยกตามผู้บริหารแต่ละท่าน
   * จึงตรวจสอบจาก RewardId หรือ RewardOwner / RewardExecutive เป็นหลัก
   * รองรับกรณีผู้บริหารมีของรางวัลมากกว่า 1 รางวัล โดยรวบรวมผู้ได้รับรางวัลทั้งหมดเรียงตามเวลา
   */
  function getWinnersForExtraReward(reward, allExtraRewards) {
    if (!reward) return [];
    const rId = String(reward.id || '').trim();
    const rOwner = String(reward.owner || '').trim();
    const rOwnerClean = rOwner.replace(/^คุณ\s*/, '').trim().toLowerCase();
    const rName = String(reward.name || '').trim().toLowerCase();

    const winnersMap = new Map();

    // 1. ตรวจสอบโดยตรงจาก RewardId (ถ้ามี)
    if (rId) {
      state.employees.forEach(e => {
        if (e && e.RewardName && String(e.RewardId || '').trim() === rId) {
          winnersMap.set(String(e.EmployeeID || e.id), e);
        }
      });
    }

    // 2. ตรวจสอบจากชื่อผู้บริหาร (RewardOwner หรือ RewardExecutive)
    if (rOwnerClean) {
      state.employees.forEach(e => {
        if (!e || !e.RewardName) return;
        const eOwner = String(e.RewardOwner || e.RewardExecutive || '').trim().replace(/^คุณ\s*/, '').trim().toLowerCase();
        if (eOwner !== '' && eOwner === rOwnerClean) {
          winnersMap.set(String(e.EmployeeID || e.id), e);
        }
      });
    }

    // 3. กรณีข้อมูลเดิมที่บันทึกไว้ก่อนหน้า (มีเฉพาะ RewardName ตรงกัน แต่ยังไม่มี RewardOwner/RewardId)
    if (winnersMap.size === 0) {
      const list = Array.isArray(allExtraRewards) ? allExtraRewards : getGroupExtraRewards();
      const legacyWinners = state.employees.filter(e => {
        if (!e || !e.RewardName) return false;
        const eName = String(e.RewardName).trim().toLowerCase();
        const eOwner = String(e.RewardOwner || e.RewardExecutive || '').trim();
        const eId = String(e.RewardId || '').trim();
        return eName === rName && !eOwner && !eId;
      });

      if (legacyWinners.length > 0 && list.length > 0) {
        // รายการสุดท้าย (คุณพรรษิษฐ์) ที่ถูกเลือกเป็นค่าเริ่มต้นตอนสุ่มครั้งแรก
        const lastReward = list[list.length - 1];
        const isTargetLast = (reward === lastReward) ||
          (rId && String(lastReward.id || '').trim() === rId) ||
          (rOwnerClean && String(lastReward.owner || '').replace(/^คุณ\s*/, '').trim().toLowerCase() === rOwnerClean);

        if (isTargetLast) {
          legacyWinners.forEach(leg => {
            leg.RewardOwner = reward.owner || '';
            leg.RewardExecutive = reward.owner || '';
            leg.RewardId = reward.id || '';
            leg.RewardGroup = 'Group Extra';
            if (state.db) {
              const docId = leg.id || String(leg.EmployeeID);
              state.db.collection(state.collectionName).doc(docId).set({
                RewardOwner: reward.owner || '',
                RewardExecutive: reward.owner || '',
                RewardId: reward.id || '',
                RewardGroup: 'Group Extra'
              }, { merge: true }).catch(() => {});
            }
            winnersMap.set(String(leg.EmployeeID || leg.id), leg);
          });
        }
      }
    }

    const winners = Array.from(winnersMap.values());
    // เรียงลำดับตามเวลาที่สุ่มได้ เพื่อให้แสดงลำดับที่ 1, 2, ... ถูกต้องตามความเป็นจริง
    winners.sort((a, b) => {
      const tA = String(a.RewardDrawTime || a.RewardTime || '');
      const tB = String(b.RewardDrawTime || b.RewardTime || '');
      return tA.localeCompare(tB);
    });

    return winners;
  }

  /**
   * ตรวจสอบและสรุปรายการของรางวัลตาม Group จากตารางของรางวัล (AL_Reward)
   * แสดงเฉพาะกลุ่มที่มีรายการของรางวัลอยู่จริงในตารางเท่านั้น
   */
  function getActiveRewardGroups() {
    const rewardsList = (state.rewards && state.rewards.length > 0) ? state.rewards : [];
    const groupMap = new Map();

    rewardsList.forEach(r => {
      if (!r) return;
      const grp = String(r.group || '').trim();
      const name = String(r.name || '').trim();
      // แสดงรายการเฉพาะของรางวัลที่มีรายการอยู่เท่านั้น
      if (!grp || !name || name === '-') return;

      if (!groupMap.has(grp)) {
        groupMap.set(grp, {
          group: grp,
          groupName: '',
          prizes: [],
          totalQty: 0,
          drawnQty: 0,
          remainQty: 0,
          isComplete: false
        });
      }

      const info = groupMap.get(grp);
      if (!info.groupName && r.groupName && String(r.groupName).trim() !== '') {
        info.groupName = String(r.groupName).trim();
      }
      const qty = Math.max(1, parseInt(r.quantity, 10) || 1);
      info.prizes.push({ ...r, quantity: qty });
      info.totalQty += qty;
    });

    // ตรวจสอบจำนวนรางวัลที่สุ่มแล้ว (drawnQty) จากตาราง AL_Employee
    groupMap.forEach(info => {
      if (info.group === 'Group Extra') {
        const extraRewards = getGroupExtraRewards();
        let totalDrawn = 0;
        info.prizes.forEach(p => {
          const w = getWinnersForExtraReward(p, extraRewards);
          totalDrawn += Math.min(Number(p.quantity) || 1, w.length);
        });
        info.drawnQty = totalDrawn;
      } else {
        const prizeNamesLower = info.prizes.map(p => String(p.name || '').trim().toLowerCase());
        const drawn = state.employees.filter(e => {
          if (!e || !e.RewardName) return false;
          if (e.RewardGroup === 'Group Extra') return false;
          const rName = String(e.RewardName).trim().toLowerCase();
          return rName !== '' && rName !== '-' && prizeNamesLower.includes(rName);
        }).length;
        info.drawnQty = drawn;
      }

      info.remainQty = Math.max(0, info.totalQty - info.drawnQty);
      info.isComplete = (info.remainQty === 0 && info.totalQty > 0);
    });

    // เรียงลำดับตาม Group (Group-1 ถึง Group Extra) จากน้อยไปมาก
    return Array.from(groupMap.values()).sort((a, b) => compareRewardGroups(a, b));
  }

  function renderRewardGroupsGrid() {
    const grid = document.getElementById('rewardGroupsGrid');
    if (!grid) return;

    const activeGroups = getActiveRewardGroups();

    // ปรับขนาดความกว้างของกล่อง Group ให้เหมาะสมกับจำนวนปุ่มที่มีในกล่อง
    grid.setAttribute('data-group-count', String(activeGroups.length));
    const section = document.querySelector('.group-select-section');
    if (section) {
      if (activeGroups.length <= 1) {
        section.style.maxWidth = '360px';
      } else if (activeGroups.length === 2 || activeGroups.length === 4) {
        section.style.maxWidth = '620px';
      } else {
        section.style.maxWidth = '860px';
      }
    }

    if (activeGroups.length === 0) {
      grid.innerHTML = `
        <div class="groups-empty-state">
          <span class="empty-icon">🎁</span>
          <p>ยังไม่มีรายการของรางวัลที่กำหนดในระบบ</p>
        </div>
      `;
      return;
    }

    const html = activeGroups.map(item => {
      const grp = item.group;
      const grpClass = grp.replace(/\s+/g, '-');
      const prizeNames = item.prizes.map(p => p.name).join(', ');
      const isComplete = item.isComplete;
      const displayGroupName = (item.groupName && item.groupName.trim() !== '') ? item.groupName.trim() : grp;

      return `
        <div class="group-choice-card badge-group-${escapeHtml(grpClass)} ${isComplete ? 'is-complete' : ''}" 
             onclick="window.goToDrawByGroup('${escapeHtml(grp)}')" 
             title="คลิกเพื่อเลือกสุ่มของรางวัลกลุ่ม ${escapeHtml(displayGroupName)}: ${escapeHtml(prizeNames)}">
          
          <div class="group-card-top-row">
            <span class="group-choice-badge badge-group badge-group-${escapeHtml(grpClass)}">${escapeHtml(displayGroupName)}</span>
            ${isComplete ? 
              '<span class="group-status-pill status-complete">✓ สุ่มครบแล้ว</span>' : 
              `<span class="group-status-pill status-remain">คงเหลือ ${item.remainQty}</span>`
            }
          </div>

          <div class="group-choice-name" title="${escapeHtml(prizeNames)}">${escapeHtml(prizeNames)}</div>

          <!-- สรุปจำนวนของรางวัล และจำนวนรางวัลที่สุ่ม โดยตรวจสอบจากตารางของรางวัล -->
          <div class="group-choice-stats-grid">
            <div class="g-stat-item" title="จำนวนของรางวัลทั้งหมดในกลุ่มนี้">
              <span class="g-stat-label">ของรางวัล</span>
              <span class="g-stat-value text-blue">${item.totalQty}</span>
            </div>
            <div class="g-stat-divider"></div>
            <div class="g-stat-item" title="จำนวนรางวัลที่สุ่มไปแล้ว">
              <span class="g-stat-label">สุ่มแล้ว</span>
              <span class="g-stat-value text-orange">${item.drawnQty}</span>
            </div>
            <div class="g-stat-divider"></div>
            <div class="g-stat-item" title="จำนวนรางวัลที่พร้อมสุ่ม">
              <span class="g-stat-label">คงเหลือ</span>
              <span class="g-stat-value ${item.remainQty === 0 ? 'text-gray' : 'text-green'}">${item.remainQty}</span>
            </div>
          </div>

          <!-- กล่อง/ปุ่มกดสุ่มรางวัล -->
          <div class="group-choice-action-wrap">
            <button type="button" 
                    class="btn-group-draw-action ${isComplete ? 'is-complete' : ''}" 
                    onclick="window.goToDrawByGroup('${escapeHtml(grp)}'); event.stopPropagation();"
                    title="${isComplete ? 'ของรางวัลกลุ่มนี้สุ่มครบแล้ว' : `กดสุ่มรางวัลกลุ่ม ${escapeHtml(displayGroupName)}`}">
              <span class="btn-action-icon">${isComplete ? '✓' : '🎲'}</span>
              <span class="btn-action-text">${isComplete ? 'สุ่มครบแล้ว' : 'กดสุ่มรางวัล'}</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    grid.innerHTML = html;
  }

  function renderDrawGroupsFilterBar() {
    const bar = document.getElementById('drawGroupsFilterBar');
    if (!bar) return;

    const activeGroups = getActiveRewardGroups();
    if (activeGroups.length === 0) {
      bar.innerHTML = '';
      return;
    }

    // หาก currentFilter เป็น 'ALL' หรือไม่มีในกลุ่ม ให้เลือกกลุ่มแรกเป็นค่าเริ่มต้น
    if (!state.filterPrizeGroup || state.filterPrizeGroup === 'ALL' || !activeGroups.some(g => g.group === state.filterPrizeGroup)) {
      state.filterPrizeGroup = activeGroups[0].group;
    }

    const currentFilter = state.filterPrizeGroup;

    // จากภาพให้ปุ่มทุกกลุ่มออก (เอาปุ่มทุกกลุ่มออกตามคำขอ)
    let html = '';

    activeGroups.forEach(item => {
      const grp = item.group;
      const grpClass = grp.replace(/\s+/g, '-');
      const isActive = (currentFilter === grp);
      // ส่วนของชื่อ Group หากมีฟิวด์ Group Name ให้ใช้ฟิวด์นี้แทน
      const displayGroupName = (item.groupName && item.groupName.trim() !== '') ? item.groupName.trim() : grp;
      const chipLabel = `${displayGroupName} (${item.remainQty}/${item.totalQty})`;
      html += `
        <button type="button" class="group-filter-chip badge-chip-${escapeHtml(grpClass)} ${isActive ? 'active' : ''}" 
                onclick="window.goToDrawByGroup('${escapeHtml(grp)}')"
                title="${escapeHtml(displayGroupName)} (${item.remainQty}/${item.totalQty})">
          ${escapeHtml(chipLabel)}
        </button>
      `;
    });

    bar.innerHTML = html;
  }

  function getDisplayRewards() {
    let list = state.rewards && state.rewards.length > 0 ? [...state.rewards] : [];
    list.sort(compareRewardGroups);

    // If specific group selected
    if (state.filterPrizeGroup && state.filterPrizeGroup !== 'ALL') {
      const filtered = list.filter(r => (r.group || '') === state.filterPrizeGroup);
      return filtered;
    }

    return list;
  }

  // ===========================================================================
  // GROUP EXTRA SPECIALIZED STAGE (50% LEFT / 50% RIGHT)
  // ===========================================================================
  function getGroupExtraRewards() {
    const allRewards = state.rewards || [];
    const list = allRewards.filter(r => r && String(r.group || '').trim() === 'Group Extra');
    list.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    return list;
  }

  function renderGroupExtraStage() {
    const wrap = document.getElementById('groupExtraStageWrap');
    if (!wrap) return;

    const extraRewards = getGroupExtraRewards();
    if (extraRewards.length === 0) {
      wrap.innerHTML = `
        <div style="width: 100%; text-align: center; padding: 40px; background: rgba(15, 23, 42, 0.7); border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.1);">
          <span style="font-size: 40px;">👑</span>
          <h3 style="color: #fde047; margin-top: 10px;">ยังไม่มีรายการของรางวัลในกลุ่ม Group Extra</h3>
          <p style="color: #94a3b8; font-size: 14px;">สามารถไปที่หน้าจัดการข้อมูล (Admin) เพื่อเพิ่มรายการของรางวัลใน Group Extra</p>
        </div>
      `;
      return;
    }

    // "โดยให้ทำการ Selected รายการสุดท้ายก่อน"
    let selectedIndex = -1;
    if (state.selectedExtraRewardId) {
      selectedIndex = extraRewards.findIndex((r, idx) => 
        (r.id && r.id === state.selectedExtraRewardId) || ('idx_' + idx) === state.selectedExtraRewardId
      );
    }
    if (selectedIndex === -1) {
      selectedIndex = extraRewards.length - 1; // Default to LAST item!
      state.selectedExtraRewardId = extraRewards[selectedIndex].id || ('idx_' + selectedIndex);
    }
    const selectedReward = extraRewards[selectedIndex];

    // Left Side Data
    const ownerPhoto = (selectedReward.ownerImage && selectedReward.ownerImage.trim() !== '') 
      ? selectedReward.ownerImage 
      : './images/person.png';
    const ownerName = selectedReward.owner || 'ผู้บริหาร';
    const ownerPosition = selectedReward.ownerPosition || 'ผู้บริหารระดับสูง';

    // Right Side Data
    const cleanPrizeName = String(selectedReward.name || 'ของรางวัลพิเศษ').trim();
    const totalQty = Math.max(1, parseInt(selectedReward.quantity, 10) || 1);
    // ตรวจสอบผู้ได้รับรางวัลเฉพาะของผู้บริหารท่านนี้ (เรียงลำดับเวลาที่สุ่มได้)
    const prizeWinners = getWinnersForExtraReward(selectedReward, extraRewards);
    const drawnCount = prizeWinners.length;
    const remainingCount = Math.max(0, totalQty - drawnCount);
    const isComplete = (remainingCount === 0);
    const latestWinner = prizeWinners.length > 0 ? prizeWinners[prizeWinners.length - 1] : null;

    wrap.innerHTML = `
      <!-- ด้านซ้าย: กว้าง 50% แสดงรูป ./images/person.png แสดงชื่อ-นามสกุล และแสดงตำแหน่ง ด้านล่างสร้างกล่องตามจำนวนข้อมูลใน Group -->
      <div class="extra-col-left">
        <!-- ส่วนบน: แสดงรูป ./images/person.png แสดงชื่อ-นามสกุล และแสดงตำแหน่ง -->
        <div class="extra-featured-executive-card">
          <div class="extra-featured-person-frame">
            <img src="${escapeHtml(ownerPhoto)}" 
                 class="extra-featured-person-img" 
                 alt="${escapeHtml(ownerName)}" 
                 onerror="this.onerror=null; this.src='./images/person.png';">
          </div>
          <div class="extra-featured-person-name">${escapeHtml(ownerName)}</div>
          <div class="extra-featured-person-position">${escapeHtml(ownerPosition)}</div>
        </div>

        <!-- ส่วนล่าง: สร้างกล่องตามจำนวนข้อมูลใน Group แสดงรูปผู้บริหาร ชื่อ-นามสกุล จำนวนของรางวัล -->
        <div class="extra-items-selector-section">
          <div class="extra-selector-header">
            <span>รายการของรางวัลในกลุ่ม Group Extra</span>
            <span class="extra-selector-count">${extraRewards.length} รายการ</span>
          </div>
          <div class="extra-items-grid">
            ${extraRewards.map((item, idx) => {
              const isSelected = (idx === selectedIndex);
              const itemImg = (item.ownerImage && item.ownerImage.trim() !== '') ? item.ownerImage : './images/person.png';
              const itemQty = Math.max(1, parseInt(item.quantity, 10) || 1);
              const itemWinners = getWinnersForExtraReward(item, extraRewards);
              const itemDrawn = itemWinners.length;
              const itemRemain = Math.max(0, itemQty - itemDrawn);
              const isDone = (itemRemain === 0);

              return `
                <div class="extra-item-box ${isSelected ? 'is-selected' : ''} ${isDone ? 'is-done' : ''}"
                     onclick="window.selectExtraRewardItem('${escapeHtml(item.id || ('idx_' + idx))}', ${idx})"
                     title="คลิกเพื่อเลือก: ${escapeHtml(item.owner || 'ผู้บริหาร')} - ${escapeHtml(item.name || '')}">
                  <div class="extra-item-avatar-wrap">
                    <img src="${escapeHtml(itemImg)}" 
                         class="extra-item-avatar" 
                         alt="${escapeHtml(item.owner || 'ผู้บริหาร')}" 
                         onerror="this.onerror=null; this.src='./images/person.png';">
                    ${isSelected ? '<span class="extra-item-badge-selected">✓</span>' : ''}
                  </div>
                  <div class="extra-item-info">
                    <div class="extra-item-owner">${escapeHtml(item.owner || 'ผู้บริหาร')}</div>
                    <div class="extra-item-prize" title="${escapeHtml(item.name || '')}">${escapeHtml(item.name || 'ของรางวัล')}</div>
                    <div class="extra-item-qty">
                      <span>จำนวน ${itemQty} รางวัล</span>
                      ${isDone ? '<span class="extra-item-status-tag status-done">ครบแล้ว</span>' : `<span class="extra-item-status-tag status-remain">เหลือ ${itemRemain}</span>`}
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- ด้านขวา: กว้าง 50% แสดงชื่อของรางวัล และกล่องแสดงผู้รับรางวัลตามจำนวนรางวัล -->
      <div class="extra-col-right">
        <div class="extra-draw-card">
          <!-- 1. ด้านบน: แสดง ชื่อของรางวัล -->
          <div class="extra-prize-header-block">
            <div class="extra-prize-sub-tag">
              <span class="badge-group badge-group-Group-Extra">
                ${escapeHtml((selectedReward.groupName && selectedReward.groupName.trim() !== '') ? selectedReward.groupName.trim() : 'Group Extra')}
              </span>
            </div>
            <h2 class="extra-prize-title">${escapeHtml(cleanPrizeName)}</h2>
            <div class="extra-prize-quota">
              <span>จำนวนทั้งหมด ${totalQty} รางวัล</span>
              <span>•</span>
              <span style="color: ${isComplete ? '#94a3b8' : '#34d399'}; font-weight: 700;">
                ${isComplete ? `สุ่มครบแล้ว (${drawnCount}/${totalQty})` : `คงเหลือ ${remainingCount} รางวัล`}
              </span>
            </div>
          </div>

          <!-- 2. ส่วนกลาง: หาก totalQty > 1 แสดงเป็นตารางครบตามจำนวนรางวัล หาก totalQty === 1 แสดงกล่องเดี่ยว -->
          ${totalQty > 1 ? `
            <div class="extra-winners-table-container">
              <table class="extra-winners-table">
                <thead>
                  <tr>
                    <th style="width: 15%; text-align: center;">ลำดับ</th>
                    <th style="width: 18%; text-align: center;">รหัสพนักงาน</th>
                    <th style="width: 32%;">ชื่อ - นามสกุล ผู้โชคดี</th>
                    <th style="width: 17%; text-align: center;">สังกัด</th>
                    <th style="width: 18%; text-align: center;">เวลาที่สุ่ม</th>
                  </tr>
                </thead>
                <tbody>
                  ${Array.from({ length: totalQty }).map((_, i) => {
                    const winner = prizeWinners[i] || null;
                    const isNext = (!winner && i === drawnCount);
                    const slotHasWinner = !!winner;
                    const winnerEmpName = winner ? ((winner.EmpName && winner.EmpName !== '-') ? winner.EmpName : 'พนักงาน ttb') : '';
                    const winnerEmpId = winner ? (winner.EmployeeID || '-') : '';
                    const winnerTime = winner ? (winner.RewardDrawTime || winner.RewardTime || '') : '';
                    const winnerGroup = winner ? (winner.Group || 'ttb') : '';
                    const isNewlyAdded = winner && state.latestWinnerId && String(state.latestWinnerId) === String(winner.EmployeeID);

                    return `
                      <tr class="extra-table-row ${slotHasWinner ? 'has-winner' : (isNext ? 'is-next' : 'is-waiting')} ${isNewlyAdded ? 'just-drawn' : ''}" 
                          id="extraTableRow_${i}"
                          ${slotHasWinner ? `onclick="window.showWinnerClaimModal('${escapeHtml(winnerEmpId)}')" style="cursor: pointer;" title="คลิกเพื่อดูรายละเอียดและบันทึกรับรางวัล"` : ''}>
                        <td style="text-align: center;">
                          <span class="tbl-order-tag ${slotHasWinner ? 'won' : (isNext ? 'next' : '')}">
                            ${slotHasWinner ? '✓' : (isNext ? '▶' : '⏳')} รางวัลที่ ${i + 1}
                          </span>
                        </td>
                        <td style="text-align: center;">
                          ${slotHasWinner ? `
                            <span class="tbl-emp-id">${escapeHtml(winnerEmpId)}</span>
                          ` : (isNext ? `
                            <span class="tbl-emp-id is-next">พร้อมสุ่ม</span>
                          ` : `
                            <span class="tbl-emp-id is-empty">-----</span>
                          `)}
                        </td>
                        <td>
                          ${slotHasWinner ? `
                            <span class="tbl-emp-name" title="${escapeHtml(winnerEmpName)}">${escapeHtml(winnerEmpName)}</span>
                          ` : (isNext ? `
                            <span class="tbl-emp-name is-next">กดปุ่มด้านล่างเพื่อเริ่มสุ่ม</span>
                          ` : `
                            <span class="tbl-emp-name is-empty">รอทำการสุ่ม</span>
                          `)}
                        </td>
                        <td style="text-align: center;">
                          ${slotHasWinner ? `
                            <span class="tbl-emp-group">${escapeHtml(winnerGroup)}</span>
                          ` : `
                            <span class="tbl-emp-group is-empty">-</span>
                          `}
                        </td>
                        <td style="text-align: center;">
                          ${slotHasWinner ? `
                            <span class="tbl-time-pill">${escapeHtml(winnerTime ? (winnerTime.split(' ')[1] || winnerTime) : 'สุ่มแล้ว')}</span>
                          ` : (isNext ? `
                            <span class="tbl-status-pill next">ลำดับถัดไป</span>
                          ` : `
                            <span class="tbl-status-pill wait">รอดำเนินการ</span>
                          `)}
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="extra-winner-stage-box" id="extraWinnerStageBox">
              <div id="extraSlot_0" style="width: 100%;">
                <!-- บรรทัดที่ 1: รหัสพนักงาน -->
                <div class="extra-winner-field-line">
                  <div class="field-label-small">
                    <span>🏷️</span>
                    <span>รหัสพนักงาน</span>
                  </div>
                  <div class="field-value-big id-box ${latestWinner ? 'has-winner' : 'is-empty'}" id="extraDisplayEmpId">
                    ${latestWinner ? escapeHtml(latestWinner.EmployeeID) : 'รหัสพนักงาน'}
                  </div>
                </div>

                <!-- บรรทัดที่ 2: ชื่อ-นามสกุล ผู้ได้รับการสุ่มเลือก -->
                <div class="extra-winner-field-line" style="margin-top: 18px;">
                  <div class="field-label-small">
                    <span>🏆</span>
                    <span>ชื่อ-นามสกุล ผู้ได้รับการสุ่มเลือก</span>
                  </div>
                  <div class="field-value-big name-box ${latestWinner ? 'has-winner' : 'is-empty'}" id="extraDisplayEmpName">
                    ${latestWinner ? escapeHtml((latestWinner.EmpName && latestWinner.EmpName !== '-') ? latestWinner.EmpName : 'พนักงาน ttb') : 'ชื่อ-นามสกุล ผู้โชคดี'}
                  </div>
                </div>

                <!-- ข้อมูลเสริมใต้ชื่อ: สังกัด / เวลาที่สุ่ม -->
                <div class="extra-winner-subline" id="extraDisplaySubNote">
                  ${latestWinner ? `
                    <div class="winner-meta-pill">
                      <span>สังกัด: ${escapeHtml(latestWinner.Group || 'ttb')}</span>
                      <span>•</span>
                      <span>เวลาสุ่ม: ${escapeHtml(latestWinner.RewardDrawTime || latestWinner.RewardTime || 'สุ่มแล้ว')}</span>
                    </div>
                  ` : `
                    <div class="winner-waiting-pill">
                      <span>✨ พร้อมทำการสุ่มรางวัล</span>
                    </div>
                  `}
                </div>
              </div>
            </div>
          `}

          <!-- 3. ด้านล่าง: แสดงปุ่มกดสุ่มรางวัล และปุ่มสุ่มใหม่ -->
          <div class="extra-draw-button-container">
            <button type="button" 
                    class="btn-extra-draw-action ${isComplete ? 'is-complete' : ''}" 
                    id="btnExtraDrawHero"
                    onclick="window.executeExtraPrizeDraw('${escapeHtml(selectedReward.id || ('idx_' + selectedIndex))}')"
                    ${isComplete ? 'disabled' : ''}>
              <span class="btn-extra-icon">${isComplete ? '✓' : '🎲'}</span>
              <span class="btn-extra-text" id="btnExtraDrawLabel">
                ${isComplete 
                  ? `สุ่มครบแล้ว (${totalQty}/${totalQty})` 
                  : (totalQty > 1 ? (drawnCount > 0 ? `สุ่มรางวัลที่เหลือทั้งหมด (${remainingCount} รางวัล)` : `สุ่มของรางวัลทั้งหมด (${totalQty} รางวัล)`) : 'คลิกเพื่อสุ่มรางวัล')}
              </span>
            </button>

            ${drawnCount > 0 ? `
              <button type="button" 
                      class="btn-extra-redraw-small" 
                      onclick="window.confirmRedrawExtraPrize('${escapeHtml(selectedReward.id || ('idx_' + selectedIndex))}')"
                      title="คลิกเพื่อยกเลิกและสุ่มใหม่">
                🔄 สุ่มใหม่
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  window.selectExtraRewardItem = function(rewardId, idx, isBroadcast = true) {
    state.selectedExtraRewardId = rewardId;
    renderGroupExtraStage();
    if (isBroadcast) {
      broadcastLiveDrawEvent({
        type: 'EXTRA_SELECT',
        group: 'Group Extra',
        rewardId: rewardId,
        idx: idx
      });
    }
  };

  /**
   * เล่นอนิเมชั่นสุ่มรางวัลของ Group Extra (ใช้งานทั้งเครื่องหลัก Master และเครื่องตาม Follower)
   * - กรณีมีมากกว่า 1 รางวัล: แสดงผลการสุ่มแบบ "สุ่มปกติ" (Roulette Modal) กลางหน้าจอ โดยสุ่มรวดเดียวครบตามจำนวนที่เหลือ
   * - กรณีมี 1 รางวัล: แสดงผลการสุ่มบนการ์ดเดี่ยว (In-Place)
   */
  async function runExtraDrawPlayback(data, isMaster = true) {
    if (state.filterPrizeGroup !== 'Group Extra') {
      state.filterPrizeGroup = 'Group Extra';
      showView('draw');
      renderPrizesGrid();
      renderDrawGroupsFilterBar();
    }

    state.isRouletteRunning = true;
    state.isExtraDrawRunning = true;
    if (data.rewardId) {
      state.selectedExtraRewardId = data.rewardId;
    }
    renderGroupExtraStage();

    const totalQty = Number(data.totalQty) || 1;
    const steps = (Array.isArray(data.steps) && data.steps.length > 0)
      ? data.steps
      : [{
          slotIndex: (data.slotIndex !== undefined && data.slotIndex !== null) ? Number(data.slotIndex) : 0,
          candidate: data.winnerCandidate,
          time: data.formattedTime
        }];

    const btn = document.getElementById('btnExtraDrawHero');
    const btnLabel = document.getElementById('btnExtraDrawLabel');
    if (btn) btn.disabled = true;
    if (btnLabel) {
      btnLabel.textContent = `กำลังสุ่มของรางวัล...`;
    }

    const eligible = getEligibleCandidates();
    const newlyDrawn = [];

    if (totalQty > 1) {
      // =========================================================================
      // สุ่มรางวัลกรณีมีมากกว่า 1 รายการ: แสดงผลการสุ่มแบบ "สุ่มปกติ" (Roulette Modal)
      // วนสุ่มทีละรางวัลจนครบทุกรางวัลที่ยังไม่ได้สุ่มในการกดครั้งเดียว
      // =========================================================================
      if (drawRouletteModal) {
        drawRouletteModal.style.display = 'flex';
      }

      const rollDuration = steps.length > 3 ? 1200 : 1600;
      const revealDuration = steps.length > 3 ? 1100 : 1500;

      for (let sIdx = 0; sIdx < steps.length; sIdx++) {
        if (!state.isRouletteRunning) break;
        const stepItem = steps[sIdx];
        const slotIdx = stepItem.slotIndex;
        const winnerCandidate = stepItem.candidate;
        const formattedTime = stepItem.time;
        const finalWinnerName = (winnerCandidate.EmpName && winnerCandidate.EmpName !== '-') ? winnerCandidate.EmpName : 'พนักงาน ttb';
        const safePool = (eligible && eligible.length > 0) ? eligible : (state.employees && state.employees.length > 0 ? state.employees : [winnerCandidate]);

        if (roulettePrizeBadge) {
          roulettePrizeBadge.textContent = `👑 ${data.rewardData.owner || 'ผู้บริหาร'} • สุ่มรางวัลที่ ${slotIdx + 1} (${slotIdx + 1}/${totalQty})`;
        }
        if (roulettePrizeTitle) {
          roulettePrizeTitle.textContent = data.rewardData.cleanName;
        }
        if (roulettePrizeThumb) {
          const thumbImg = data.rewardData.ownerImage || data.rewardData.imageUrl || './images/person.png';
          roulettePrizeThumb.innerHTML = `<img src="${escapeHtml(thumbImg)}" alt="${escapeHtml(data.rewardData.cleanName)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.onerror=null; this.parentElement.innerHTML='🎁';">`;
        }

        if (rouletteStageRolling) rouletteStageRolling.style.display = 'block';
        if (rouletteStageWinner) rouletteStageWinner.style.display = 'none';
        if (rollingEmpInfo) {
          rollingEmpInfo.textContent = `${data.rewardData.owner || ''} ${data.rewardData.ownerPosition ? '• ' + data.rewardData.ownerPosition : ''}`;
        }

        // หมุนสุ่มรายชื่อพร้อมเสียง tick
        const startTime = Date.now();
        await new Promise(resolve => {
          const interval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            playTickSound();
            const randSample = safePool[Math.floor(Math.random() * safePool.length)] || winnerCandidate;
            const randName = (randSample.EmpName && randSample.EmpName !== '-') ? randSample.EmpName : 'พนักงาน ttb';
            if (rollingEmpId) rollingEmpId.textContent = randSample.EmployeeID || '-----';
            if (rollingEmpName) rollingEmpName.textContent = randName;

            if (elapsed >= rollDuration) {
              clearInterval(interval);
              resolve();
            }
          }, 55);
        });

        // ประกาศผลผู้โชคดีบน Modal
        if (winnerHeroId) winnerHeroId.textContent = winnerCandidate.EmployeeID;
        if (winnerHeroName) winnerHeroName.textContent = finalWinnerName;
        if (winnerHeroDetails) {
          winnerHeroDetails.textContent = `กลุ่ม: ${winnerCandidate.Group || 'ttb'} ${winnerCandidate.Branch ? '| สาขา: ' + winnerCandidate.Branch : ''}`;
        }
        if (winnerFlyHint) {
          winnerFlyHint.innerHTML = `<span>✨ นำรายชื่อเข้าสู่ตารางรางวัลที่ ${slotIdx + 1} เรียบร้อยแล้ว (${sIdx + 1}/${steps.length})</span>`;
        }

        if (rouletteStageRolling) rouletteStageRolling.style.display = 'none';
        if (rouletteStageWinner) rouletteStageWinner.style.display = 'block';

        playWinnerFanfare();
        triggerSparkleCelebration();

        // อัปเดต state ทีละคนทันที
        let empInState = state.employees.find(e => e.EmployeeID === winnerCandidate.EmployeeID);
        if (!empInState) {
          empInState = { ...winnerCandidate };
          state.employees.push(empInState);
        }
        empInState.RewardName = data.rewardData.cleanName;
        empInState.RewardOwner = data.rewardData.owner || '';
        empInState.RewardExecutive = data.rewardData.owner || '';
        empInState.RewardPosition = data.rewardData.ownerPosition || '';
        empInState.RewardOwnerPosition = data.rewardData.ownerPosition || '';
        empInState.RewardOwnerImage = data.rewardData.ownerImage || '';
        empInState.RewardImageUrl = data.rewardData.imageUrl || '';
        empInState.RewardId = data.rewardData.id;
        empInState.RewardGroup = data.rewardData.group || 'Group Extra';
        empInState.RewardDrawTime = formattedTime;
        empInState.RewardTime = formattedTime;
        empInState.RewardStatus = 'ยังไม่ได้รับรางวัล';
        state.latestWinnerId = empInState.EmployeeID;
        newlyDrawn.push(empInState);
        renderGroupExtraStage();

        // รอเปิดเผยชื่อก่อนเริ่มรางวัลถัดไป
        await new Promise(r => setTimeout(r, revealDuration));
      }

      if (drawRouletteModal) {
        drawRouletteModal.style.display = 'none';
      }

      // จุดพลุฉลองใหญ่เมื่อสุ่มครบทุกรางวัลในครั้งเดียว
      triggerGrandCelebrationFireworks();

    } else {
      // =========================================================================
      // สุ่มรางวัลกรณีมี 1 รายการ: แสดงผลการสุ่มแบบ "สุ่มปกติ" (Roulette Modal)
      // เสมือนการสุ่มปกติ พร้อมแสดงผลบนกล่องใหญ่
      // =========================================================================
      const stepItem = steps[0];
      const winnerCandidate = stepItem.candidate;
      const formattedTime = stepItem.time;
      const finalWinnerName = (winnerCandidate.EmpName && winnerCandidate.EmpName !== '-') ? winnerCandidate.EmpName : 'พนักงาน ttb';
      const safePool = (eligible && eligible.length > 0) ? eligible : (state.employees && state.employees.length > 0 ? state.employees : [winnerCandidate]);

      if (drawRouletteModal) {
        drawRouletteModal.style.display = 'flex';
      }
      if (roulettePrizeBadge) {
        roulettePrizeBadge.textContent = `👑 ${data.rewardData.owner || 'ผู้บริหาร'} • สุ่มรางวัลพิเศษ`;
      }
      if (roulettePrizeTitle) {
        roulettePrizeTitle.textContent = data.rewardData.cleanName;
      }
      if (roulettePrizeThumb) {
        const thumbImg = data.rewardData.ownerImage || data.rewardData.imageUrl || './images/person.png';
        roulettePrizeThumb.innerHTML = `<img src="${escapeHtml(thumbImg)}" alt="${escapeHtml(data.rewardData.cleanName)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.onerror=null; this.parentElement.innerHTML='🎁';">`;
      }

      if (rouletteStageRolling) rouletteStageRolling.style.display = 'block';
      if (rouletteStageWinner) rouletteStageWinner.style.display = 'none';
      if (rollingEmpInfo) {
        rollingEmpInfo.textContent = `${data.rewardData.owner || ''} ${data.rewardData.ownerPosition ? '• ' + data.rewardData.ownerPosition : ''}`;
      }

      const displayId = document.getElementById('extraDisplayEmpId');
      const displayName = document.getElementById('extraDisplayEmpName');
      const displaySubNote = document.getElementById('extraDisplaySubNote');

      if (displayId) {
        displayId.classList.remove('is-empty');
        displayId.classList.add('is-shuffling');
      }
      if (displayName) {
        displayName.classList.remove('is-empty');
        displayName.classList.add('is-shuffling');
      }
      if (displaySubNote) {
        displaySubNote.innerHTML = '<div class="winner-waiting-pill shuffling">🎲 กำลังสุ่มผู้โชคดี...</div>';
      }

      const startTime = Date.now();
      const duration = 2200;

      await new Promise(resolve => {
        const interval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          playTickSound();
          const randSample = safePool[Math.floor(Math.random() * safePool.length)] || winnerCandidate;
          const randName = (randSample.EmpName && randSample.EmpName !== '-') ? randSample.EmpName : 'พนักงาน ttb';
          if (rollingEmpId) rollingEmpId.textContent = randSample.EmployeeID || '-----';
          if (rollingEmpName) rollingEmpName.textContent = randName;
          if (displayId) displayId.textContent = randSample.EmployeeID || '-----';
          if (displayName) displayName.textContent = randName;

          if (elapsed >= duration) {
            clearInterval(interval);
            resolve();
          }
        }, 55);
      });

      // ประกาศผลผู้โชคดีบน Modal
      if (winnerHeroId) winnerHeroId.textContent = winnerCandidate.EmployeeID;
      if (winnerHeroName) winnerHeroName.textContent = finalWinnerName;
      if (winnerHeroDetails) {
        winnerHeroDetails.textContent = `กลุ่ม: ${winnerCandidate.Group || 'ttb'} ${winnerCandidate.Branch ? '| สาขา: ' + winnerCandidate.Branch : ''}`;
      }
      if (winnerFlyHint) {
        winnerFlyHint.innerHTML = `<span>🎉 ขอแสดงความยินดีกับผู้ได้รับรางวัลพิเศษ!</span>`;
      }

      if (rouletteStageRolling) rouletteStageRolling.style.display = 'none';
      if (rouletteStageWinner) rouletteStageWinner.style.display = 'block';

      playWinnerFanfare();
      triggerSparkleCelebration();
      triggerGrandCelebrationFireworks();

      if (displayId) {
        displayId.classList.remove('is-shuffling');
        displayId.classList.add('has-winner');
        displayId.textContent = winnerCandidate.EmployeeID;
      }
      if (displayName) {
        displayName.classList.remove('is-shuffling');
        displayName.classList.add('has-winner');
        displayName.textContent = finalWinnerName;
      }

      if (displaySubNote) {
        displaySubNote.innerHTML = `
          <div class="winner-meta-pill">
            <span>🎉 ขอแสดงความยินดี!</span>
            <span>•</span>
            <span>สังกัด: ${escapeHtml(winnerCandidate.Group || 'ttb')}</span>
            <span>•</span>
            <span>เวลา: ${escapeHtml(formattedTime)}</span>
          </div>
        `;
      }

      // รอเปิดเผยชื่อบน Modal ชั่วคราวให้ผู้ร่วมงานชมผลอย่างชัดเจน
      await new Promise(r => setTimeout(r, 2200));

      if (drawRouletteModal) {
        drawRouletteModal.style.display = 'none';
      }

      let empInState = state.employees.find(e => e.EmployeeID === winnerCandidate.EmployeeID);
      if (!empInState) {
        empInState = { ...winnerCandidate };
        state.employees.push(empInState);
      }
      empInState.RewardName = data.rewardData.cleanName;
      empInState.RewardOwner = data.rewardData.owner || '';
      empInState.RewardExecutive = data.rewardData.owner || '';
      empInState.RewardPosition = data.rewardData.ownerPosition || '';
      empInState.RewardOwnerPosition = data.rewardData.ownerPosition || '';
      empInState.RewardOwnerImage = data.rewardData.ownerImage || '';
      empInState.RewardImageUrl = data.rewardData.imageUrl || '';
      empInState.RewardId = data.rewardData.id;
      empInState.RewardGroup = data.rewardData.group || 'Group Extra';
      empInState.RewardDrawTime = formattedTime;
      empInState.RewardTime = formattedTime;
      empInState.RewardStatus = 'ยังไม่ได้รับรางวัล';
      state.latestWinnerId = empInState.EmployeeID;
      newlyDrawn.push(empInState);
    }

    // บันทึกลง Firestore เฉพาะเครื่อง Master ที่เป็นผู้สุ่มจริง เพื่อป้องกันการเขียนซ้ำซ้อน
    if (isMaster && state.db && newlyDrawn.length > 0) {
      try {
        const batchPromises = newlyDrawn.map(w => {
          const docId = w.id || String(w.EmployeeID);
          return state.db.collection(state.collectionName).doc(docId).set({
            RewardName: w.RewardName,
            RewardOwner: w.RewardOwner || '',
            RewardExecutive: w.RewardExecutive || '',
            RewardPosition: w.RewardPosition || '',
            RewardOwnerPosition: w.RewardOwnerPosition || '',
            RewardOwnerImage: w.RewardOwnerImage || '',
            RewardImageUrl: w.RewardImageUrl || '',
            RewardId: w.RewardId,
            RewardGroup: w.RewardGroup || 'Group Extra',
            RewardDrawTime: w.RewardDrawTime,
            RewardTime: w.RewardTime,
            RewardStatus: 'ยังไม่ได้รับรางวัล'
          }, { merge: true });
        });
        await Promise.allSettled(batchPromises);
      } catch (err) {
        console.warn("Firestore error saving extra winners:", err);
      }
    }

    // Save to localStorage & BroadcastChannel
    try {
      localStorage.setItem('AL_EMPLOYEES_DATA', JSON.stringify(state.employees));
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('AL_REALTIME_SYNC');
        channel.postMessage({
          type: 'DATABASE_SYNC',
          employees: state.employees
        });
      }
    } catch (e) {}

    // Refresh display
    checkAndBroadcastAllPrizesDrawn();
    state.isRouletteRunning = false;
    state.isExtraDrawRunning = false;
    renderGroupExtraStage();
    renderDrawGroupsFilterBar();
    updateEligiblePill();
    updateDisplay(false);
  }

  window.executeExtraPrizeDraw = async function(rewardId) {
    if (state.isExtraDrawRunning || state.isRouletteRunning) return;

    const extraRewards = getGroupExtraRewards();
    let reward = extraRewards.find(r => r.id === rewardId);
    if (!reward) {
      const idx = parseInt(String(rewardId).replace('idx_', ''), 10);
      if (!isNaN(idx) && extraRewards[idx]) {
        reward = extraRewards[idx];
      }
    }
    if (!reward) return;

    const cleanName = String(reward.name || '').trim();
    const totalQty = Math.max(1, parseInt(reward.quantity, 10) || 1);
    // ตรวจสอบจำนวนผู้ได้รับรางวัลเฉพาะของผู้บริหารท่านนี้
    const winners = getWinnersForExtraReward(reward, extraRewards);
    const drawnCount = winners.length;
    const remainingNeed = totalQty - drawnCount;

    if (remainingNeed <= 0) {
      alert("ของรางวัลของผู้บริหารท่านนี้ได้รับการสุ่มครบจำนวนแล้ว");
      return;
    }

    const eligible = getEligibleCandidates();
    if (eligible.length === 0) {
      alert("ไม่มีรายชื่อผู้มีสิทธิ์ลุ้นรางวัลที่พร้อมทำการสุ่มในขณะนี้");
      return;
    }

    const selectedIndex = extraRewards.indexOf(reward);

    // สุ่มสลับผู้มีสิทธิ์ (Fisher-Yates Shuffle)
    const pool = [...eligible];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    // สุ่มให้ครบตามจำนวนของรางวัลที่ยังไม่ได้สุ่มเลือกในการกดครั้งเดียว
    const canDrawCount = Math.min(remainingNeed, pool.length);
    const steps = [];

    for (let k = 0; k < canDrawCount; k++) {
      const slotIdx = drawnCount + k;
      const winnerCandidate = pool[k];
      const now = new Date(Date.now() + (k * 1000));
      const formattedTime = `${now.getFullYear() + 543}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

      steps.push({
        slotIndex: slotIdx,
        candidate: {
          EmployeeID: winnerCandidate.EmployeeID,
          EmpName: winnerCandidate.EmpName,
          Group: winnerCandidate.Group,
          Branch: winnerCandidate.Branch,
          id: winnerCandidate.id || String(winnerCandidate.EmployeeID)
        },
        time: formattedTime
      });
    }

    const eventData = {
      type: 'EXTRA_DRAW',
      group: 'Group Extra',
      selectedIndex: selectedIndex,
      totalQty: totalQty,
      rewardId: reward.id || ('idx_' + selectedIndex),
      rewardData: {
        cleanName,
        owner: reward.owner || '',
        ownerPosition: reward.ownerPosition || reward.position || reward.executivePosition || '',
        ownerImage: reward.ownerImage || reward.ownerImageUrl || reward.executiveImage || '',
        imageUrl: reward.imageUrl || '',
        id: reward.id || ('idx_' + selectedIndex),
        group: reward.group || 'Group Extra'
      },
      steps: steps,
      // Fallback สำหรับ single item:
      slotIndex: steps[0].slotIndex,
      winnerCandidate: steps[0].candidate,
      formattedTime: steps[0].time
    };

    // ส่งสัญญาณการสุ่มไปยังทุกเครื่องผ่าน Firestore และ BroadcastChannel
    await broadcastLiveDrawEvent(eventData);

    // เล่นอนิเมชั่นสุ่มรางวัลบนเครื่อง Master
    await runExtraDrawPlayback(eventData, true);
  };

  let pendingRedrawRewardId = null;

  window.confirmRedrawExtraPrize = function(rewardId) {
    const extraRewards = getGroupExtraRewards();
    let reward = extraRewards.find(r => r.id === rewardId);
    if (!reward) {
      const idx = parseInt(String(rewardId).replace('idx_', ''), 10);
      if (!isNaN(idx) && extraRewards[idx]) {
        reward = extraRewards[idx];
      }
    }
    if (!reward) return;

    const winners = getWinnersForExtraReward(reward, extraRewards);
    if (winners.length === 0) return;

    const winner = winners[winners.length - 1];
    pendingRedrawRewardId = reward.id || ('idx_' + extraRewards.indexOf(reward));

    // ดึง Element ของ Lightbox ยืนยันการลบรายชื่อ
    const modal = document.getElementById('extraRedrawConfirmModal');
    if (!modal) return;

    const elPrize = document.getElementById('redrawModalPrizeName');
    const elExec = document.getElementById('redrawModalExecutiveName');
    const elId = document.getElementById('redrawModalEmpId');
    const elName = document.getElementById('redrawModalEmpName');
    const elGroup = document.getElementById('redrawModalEmpGroup');
    const elTime = document.getElementById('redrawModalDrawTime');

    if (elPrize) elPrize.textContent = reward.name || 'รางวัลพิเศษ';
    if (elExec) elExec.textContent = reward.owner || 'ผู้บริหาร';
    if (elId) elId.textContent = winner.EmployeeID || '-';
    if (elName) elName.textContent = (winner.EmpName && winner.EmpName !== '-') ? winner.EmpName : 'พนักงาน ttb';
    if (elGroup) elGroup.textContent = winner.Group || 'ttb';
    if (elTime) elTime.textContent = winner.RewardDrawTime || winner.RewardTime || '-';

    modal.style.display = 'flex';
  };

  window.closeRedrawConfirmModal = function() {
    const modal = document.getElementById('extraRedrawConfirmModal');
    if (modal) modal.style.display = 'none';
    pendingRedrawRewardId = null;
  };

  window.executeConfirmedRedraw = async function() {
    if (!pendingRedrawRewardId) return;
    const rewardId = pendingRedrawRewardId;
    window.closeRedrawConfirmModal();

    const extraRewards = getGroupExtraRewards();
    let reward = extraRewards.find(r => r.id === rewardId);
    if (!reward) {
      const idx = parseInt(String(rewardId).replace('idx_', ''), 10);
      if (!isNaN(idx) && extraRewards[idx]) {
        reward = extraRewards[idx];
      }
    }
    if (!reward) return;

    const winners = getWinnersForExtraReward(reward, extraRewards);
    if (winners.length === 0) return;

    const clearedWinnerIds = winners.map(w => w.EmployeeID);
    await broadcastLiveDrawEvent({
      type: 'EXTRA_RESET',
      group: 'Group Extra',
      rewardId: rewardId,
      clearedWinnerIds: clearedWinnerIds
    });

    for (const w of winners) {
      w.RewardName = '';
      w.RewardOwner = '';
      w.RewardExecutive = '';
      w.RewardId = '';
      w.RewardGroup = '';
      w.RewardDrawTime = null;
      w.RewardTime = null;
      w.RewardStatus = 'ยังไม่ได้รับรางวัล';

      if (state.db) {
        try {
          const docId = w.id || String(w.EmployeeID);
          await state.db.collection(state.collectionName).doc(docId).set({
            RewardName: '',
            RewardOwner: '',
            RewardExecutive: '',
            RewardId: '',
            RewardGroup: '',
            RewardDrawTime: null,
            RewardTime: null,
            RewardStatus: 'ยังไม่ได้รับรางวัล'
          }, { merge: true });
        } catch (e) {}
      }
    }

    localStorage.setItem('AL_EMPLOYEES_DATA', JSON.stringify(state.employees));
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('AL_REALTIME_SYNC');
      channel.postMessage({ type: 'DATABASE_SYNC', employees: state.employees });
    }

    renderGroupExtraStage();
    renderDrawGroupsFilterBar();
    updateEligiblePill();
    updateDisplay(false);
  };

  function initExtraRedrawModal() {
    const modal = document.getElementById('extraRedrawConfirmModal');
    const btnClose = document.getElementById('btnCloseRedrawModal');
    const btnCancel = document.getElementById('btnCancelRedrawAction');
    const btnConfirm = document.getElementById('btnConfirmRedrawAction');

    if (btnClose) {
      btnClose.addEventListener('click', () => window.closeRedrawConfirmModal());
    }
    if (btnCancel) {
      btnCancel.addEventListener('click', () => window.closeRedrawConfirmModal());
    }
    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => window.executeConfirmedRedraw());
    }
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) window.closeRedrawConfirmModal();
      });
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
        window.closeRedrawConfirmModal();
      }
    });
  }

  function renderPrizesGrid() {
    const isGroupExtra = (state.filterPrizeGroup === 'Group Extra');
    const wrapExtra = document.getElementById('groupExtraStageWrap');
    const normalGrid = document.getElementById('prizesGrid2x3');
    const triggerRow = document.getElementById('grandDrawTriggerRow');

    if (isGroupExtra) {
      if (normalGrid) normalGrid.style.display = 'none';
      if (triggerRow) triggerRow.style.display = 'none';
      if (wrapExtra) {
        wrapExtra.style.display = 'flex';
        renderGroupExtraStage();
      }
      return;
    }

    if (wrapExtra) wrapExtra.style.display = 'none';
    if (normalGrid) normalGrid.style.display = 'grid';
    if (triggerRow) triggerRow.style.display = 'flex';

    if (!prizesGrid2x3) return;

    const list = getDisplayRewards();

    prizesGrid2x3.innerHTML = list.map((r, idx) => {
      const prizeName = String(r.name || `รางวัลที่ ${idx + 1}`).trim();
      const totalQty = Number(r.quantity) || 1;

      // Find all winners for this prize from state.employees (partitioned by box quota)
      const prizeWinners = getWinnersForDisplayReward(r, idx, list);

      const drawnCount = prizeWinners.length;
      const remainingCount = Math.max(0, totalQty - drawnCount);
      const isComplete = remainingCount === 0;

      // Top image
      const imgHtml = r.imageUrl && r.imageUrl.trim() !== ''
        ? `<img src="${escapeHtml(r.imageUrl)}" alt="${escapeHtml(prizeName)}" class="prize-img" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'prize-img-placeholder\\'>🎁</span>';">`
        : `<span class="prize-img-placeholder">🎁</span>`;

      // Winners HTML (แสดงรายชื่อผู้โชคดี)
      let winnersHtml = '';
      if (prizeWinners.length > 0) {
        winnersHtml = `
          <div class="winner-slot-list">
            ${prizeWinners.map(w => {
              const empNameDisplay = (w.EmpName && w.EmpName !== '-') ? w.EmpName : 'พนักงาน ttb';
              const grpText = w.Group ? `(${w.Group})` : '';
              const timeDisplay = w.RewardDrawTime ? (w.RewardDrawTime.split(' ')[1] || 'สุ่มแล้ว') : 'สุ่มแล้ว';
              const isNewlyAdded = state.latestWinnerId && String(state.latestWinnerId) === String(w.EmployeeID);
              const isClaimed = w.RewardStatus === 'รับรางวัลแล้ว' || w.RewardStatus === 'ได้รับรางวัลแล้ว';
              return `
                <div class="winner-item-pill ${isClaimed ? 'is-claimed' : ''} ${isNewlyAdded ? 'newly-added' : ''}" 
                     onclick="window.showWinnerClaimModal('${escapeHtml(w.EmployeeID)}')" 
                     style="cursor: pointer;" 
                     title="คลิกเพื่อดูข้อมูลพนักงานและยืนยันการรับรางวัล">
                  <div class="winner-item-left" title="รหัส: ${escapeHtml(w.EmployeeID)} | ${escapeHtml(empNameDisplay)} ${escapeHtml(grpText)}">
                    <span class="winner-icon">${isClaimed ? '🎁' : '🏆'}</span>
                    <span class="winner-id-bold">${escapeHtml(w.EmployeeID)}</span>
                    <span class="winner-name-text">${escapeHtml(empNameDisplay)} ${escapeHtml(grpText)}</span>
                  </div>
                  <span class="winner-time-tag">${isClaimed ? '✓ รับรางวัลแล้ว' : escapeHtml(timeDisplay)}</span>
                </div>
              `;
            }).join('')}
          </div>
        `;
      } else {
        winnersHtml = `
          <div class="no-winner-box">
            <span class="no-winner-icon">⏳</span>
            <span>รอทำการสุ่มเลือกผู้รับรางวัล</span>
          </div>
        `;
      }

      // ส่งกลับเฉพาะกล่องที่มีส่วนบนและส่วนแสดงผู้รับรางวัล โดยไม่มีปุ่มสุ่มภายในกล่อง
      return `
        <div class="prize-card-box ${isComplete ? 'is-complete' : ''}" id="prizeCard_${idx}" data-reward-id="${escapeHtml(r.id || '')}">
          <!-- ส่วนบน: รูปภาพ และ ชื่อรางวัล -->
          <div class="prize-card-top">
            <div class="prize-img-frame" onclick="window.showPrizeDetailsModal('${escapeHtml(prizeName)}', ${idx})" style="cursor: pointer;" title="คลิกเพื่อดูรายละเอียดของรางวัลนี้">
              ${imgHtml}
            </div>
            <div class="prize-info-top">
              <!-- Animated Drawing Banner for Fast Draw -->
              <div class="box-drawing-banner" id="boxDrawingBanner_${idx}" style="display: none;">
                <span class="spin-dice-anim">🎲⚡</span>
                <span class="box-drawing-text">กำลังสุ่มเลือกผู้รับรางวัล...</span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px; flex-wrap: wrap;">
                <span class="prize-order-badge">ลำดับที่ ${idx + 1}</span>
                ${(r.group && r.group !== 'ALL') ? `<span class="badge-group badge-group-${escapeHtml(r.group.replace(/\s+/g, '-'))}" style="font-size: 11px; padding: 1px 6px;">${escapeHtml((r.groupName && r.groupName.trim() !== '') ? r.groupName.trim() : r.group)}</span>` : ''}
              </div>
              <h3 class="prize-name-title" title="${escapeHtml(prizeName)}">${escapeHtml(prizeName)}</h3>
              <div class="prize-quota-badge">
                <span>จำนวน ${totalQty} รางวัล</span>
                <span class="quota-divider">•</span>
                <span class="${isComplete ? 'quota-depleted' : 'quota-remain'}">
                  ${isComplete ? `สุ่มครบแล้ว (${drawnCount}/${totalQty})` : `คงเหลือ ${remainingCount}`}
                </span>
              </div>
            </div>
          </div>

          <!-- ส่วนกลาง: แสดงผลผู้รับรางวัล -->
          <div class="prize-card-body">
            ${winnersHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  function findBoxCard(target) {
    if (!target) return null;
    if (typeof target === 'number' || typeof target === 'string') {
      const byId = document.getElementById(`prizeCard_${target}`);
      if (byId) return byId;
      const byRewId = document.querySelector(`.prize-card-box[data-reward-id="${target}"]`);
      if (byRewId) return byRewId;
      return null;
    }
    if (target.rewardId) {
      const el = document.querySelector(`.prize-card-box[data-reward-id="${target.rewardId}"]`);
      if (el) return el;
    }
    if (target.rewardIdx !== undefined) {
      const el = document.getElementById(`prizeCard_${target.rewardIdx}`);
      if (el) return el;
    }
    return null;
  }

  function setBoxDrawingActiveState(target, isActive, text) {
    const card = findBoxCard(target);
    let banner = card ? card.querySelector('.box-drawing-banner') : null;
    if (!banner && typeof target === 'number') {
      banner = document.getElementById(`boxDrawingBanner_${target}`);
    }
    if (!banner && target && target.rewardIdx !== undefined) {
      banner = document.getElementById(`boxDrawingBanner_${target.rewardIdx}`);
    }
    if (banner) {
      banner.style.display = isActive ? 'inline-flex' : 'none';
      if (text) {
        const textElem = banner.querySelector('.box-drawing-text');
        if (textElem) textElem.textContent = text;
      }
    }
  }

  async function runBoxShufflingAnimation(boxTarget, pool, targetWinner) {
    const cardElem = findBoxCard(boxTarget);
    if (!cardElem) return;

    let slot = cardElem.querySelector('.box-live-shuffling-slot');
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'box-live-shuffling-slot';
      const prizeBody = cardElem.querySelector('.prize-card-body') || cardElem;
      prizeBody.prepend(slot);
    }

    slot.style.display = 'flex';
    const safePool = (pool && pool.length > 0) ? pool : (state.employees && state.employees.length > 0 ? state.employees : [targetWinner]);
    const shuffleSteps = 8;
    for (let s = 0; s < shuffleSteps; s++) {
      playTickSound();
      const sample = (s === shuffleSteps - 1) ? targetWinner : (safePool[Math.floor(Math.random() * safePool.length)] || targetWinner);
      const sName = (sample.EmpName && sample.EmpName !== '-') ? sample.EmpName : 'พนักงาน ttb';
      slot.innerHTML = `<span class="spin-dice-anim">🎲⚡</span> <span class="slot-shuffle-text">${sample.EmployeeID} ${sName}</span>`;
      await new Promise(r => setTimeout(r, 75));
    }
    slot.style.display = 'none';
  }

  // ===========================================================================
  // LIGHTBOX MODAL (ขนาดกว้าง 80%): QR Code ซ้าย | รางวัลขวา | สุ่มทั้งหมดด้านล่าง
  // ===========================================================================
  function applyDrawButtonsConfig(config) {
    if (!config) return;
    const showNormal = config.showNormal !== false;
    const showFast = config.showFast !== false;

    if (btnOpenGrandDrawModal) {
      btnOpenGrandDrawModal.style.display = showNormal ? 'inline-flex' : 'none';
    }
    if (btnOpenFastDrawModal) {
      btnOpenFastDrawModal.style.display = showFast ? 'inline-flex' : 'none';
      btnOpenFastDrawModal.style.marginLeft = (showNormal && showFast) ? '20px' : '0px';
    }
  }

  function initDrawButtonsSettings() {
    let settings = { showNormal: true, showFast: true };
    try {
      const saved = localStorage.getItem('AL_DRAW_BUTTON_SETTINGS');
      if (saved) {
        settings = JSON.parse(saved);
      }
    } catch (e) {}

    applyDrawButtonsConfig(settings);
  }

  function initGrandDrawModal() {
    if (btnOpenGrandDrawModal) {
      btnOpenGrandDrawModal.addEventListener('click', () => {
        state.drawMode = 'normal';
        openGrandDrawModal();
      });
    }
    if (btnOpenFastDrawModal) {
      btnOpenFastDrawModal.addEventListener('click', () => {
        state.drawMode = 'fast';
        openGrandDrawModal();
      });
    }
    if (btnCloseGrandModal) {
      btnCloseGrandModal.addEventListener('click', closeGrandDrawModal);
    }
    if (grandDrawModal) {
      grandDrawModal.addEventListener('click', (e) => {
        if (e.target === grandDrawModal && !state.isRouletteRunning) {
          closeGrandDrawModal();
        }
      });
    }
    if (btnExecuteAllDraw) {
      btnExecuteAllDraw.addEventListener('click', executeGrandDrawAll);
    }
  }

  function openGrandDrawModal() {
    if (grandDrawModal) {
      grandDrawModal.style.display = 'flex';
      if (grandModalHeadline) {
        const catSuffix = state.drawCategory === 'group' ? ' - แบบกลุ่ม' : ' - รายบุคคล';
        grandModalHeadline.textContent = state.drawMode === 'fast'
          ? '⚡ สุ่มรางวัลแบบเร็ว' + catSuffix
          : 'ระบบสุ่มเลือกผู้รับรางวัล' + catSuffix;
      }
      renderModalPrizesList();
    }
  }

  function closeGrandDrawModal() {
    if (state.isRouletteRunning) return;
    if (grandDrawModal) {
      grandDrawModal.style.display = 'none';
    }
    renderPrizesGrid();
  }

  // Render Right Column: แสดงรายละเอียดการจับรางวัล และแสดงรางวัลทั้งหมด พร้อมจำนวนรางวัล
  function renderModalPrizesList() {
    const rewards = getDisplayRewards();
    const eligibleCount = getEligibleCandidates().length;

    let totalQuota = 0;
    let totalDrawn = 0;

    rewards.forEach((r, idx) => {
      const totalQty = Math.max(1, parseInt(r.quantity, 10) || 1);
      totalQuota += totalQty;
      const drawnForThis = getWinnersForDisplayReward(r, idx, rewards).length;
      totalDrawn += Math.min(totalQty, drawnForThis);
    });

    if (modalEligibleCountPill) {
      modalEligibleCountPill.textContent = `ผู้มีสิทธิ์: ${eligibleCount.toLocaleString()} คน`;
    }
    if (modalTotalQuotaPill) {
      modalTotalQuotaPill.textContent = `รางวัลรวม: ${totalQuota.toLocaleString()} ชิ้น`;
    }
    if (modalDrawnCountPill) {
      modalDrawnCountPill.textContent = `สุ่มแล้ว: ${totalDrawn.toLocaleString()} / ${totalQuota.toLocaleString()} ชิ้น`;
    }

    const allCompleted = totalDrawn >= totalQuota && totalQuota > 0;
    if (btnExecuteAllDraw) {
      if (allCompleted) {
        btnExecuteAllDraw.disabled = true;
        btnExecuteAllDraw.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        if (btnExecuteAllText) btnExecuteAllText.textContent = `สุ่มครบทุกรางวัลแล้ว (${totalDrawn}/${totalQuota})`;
      } else {
        btnExecuteAllDraw.disabled = state.isRouletteRunning;
        btnExecuteAllDraw.style.background = state.drawMode === 'fast'
          ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)'
          : '';
        const remainingAll = Math.max(0, totalQuota - totalDrawn);
        if (btnExecuteAllText) {
          btnExecuteAllText.textContent = state.drawMode === 'fast'
            ? `⚡ สุ่มรางวัลแบบเร็ว (${remainingAll} ชิ้นคงเหลือ)`
            : `สุ่มรางวัล (${remainingAll} ชิ้นคงเหลือ)`;
        }
      }
    }

    if (!grandPrizesListContainer) return;

    grandPrizesListContainer.innerHTML = rewards.map((r, idx) => {
      const prizeName = String(r.name || `รางวัลที่ ${idx + 1}`).trim();
      const totalQty = Math.max(1, parseInt(r.quantity, 10) || 1);
      const prizeWinners = getWinnersForDisplayReward(r, idx, rewards);
      const drawn = prizeWinners.length;
      const remaining = Math.max(0, totalQty - drawn);
      const isComplete = remaining === 0;

      const imgHtml = r.imageUrl && r.imageUrl.trim() !== ''
        ? `<img src="${escapeHtml(r.imageUrl)}" alt="${escapeHtml(prizeName)}" onerror="this.onerror=null; this.parentElement.innerHTML='🎁';">`
        : `🎁`;

      return `
        <div class="grand-prize-row-item ${isComplete ? 'is-completed' : ''}">
          <div class="grand-prize-left-part">
            <div class="grand-prize-thumb" onclick="window.showPrizeDetailsModal('${escapeHtml(prizeName)}', ${idx})" style="cursor: pointer;" title="คลิกเพื่อดูรายละเอียดของรางวัลนี้">
              ${imgHtml}
            </div>
            <div class="grand-prize-info">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span class="grand-prize-order">ลำดับที่ ${idx + 1}</span>
                ${(r.group && r.group !== 'ALL') ? `<span class="badge-group badge-group-${escapeHtml(r.group.replace(/\s+/g, '-'))}" style="font-size: 11px; padding: 1px 6px;">${escapeHtml((r.groupName && r.groupName.trim() !== '') ? r.groupName.trim() : r.group)}</span>` : ''}
              </div>
              <h4 class="grand-prize-name" title="${escapeHtml(prizeName)}">${escapeHtml(prizeName)}</h4>
            </div>
          </div>
          <div class="grand-prize-right-part">
            <span class="grand-qty-badge">จำนวน ${totalQty} รางวัล</span>
            <span class="grand-status-pill ${isComplete ? 'status-done' : 'status-pending'}">
              ${isComplete ? `สุ่มครบแล้ว (${drawn}/${totalQty})` : `สุ่มแล้ว ${drawn}/${totalQty} (เหลือ ${remaining})`}
            </span>
          </div>
        </div>
      `;
    }).join('');
  }

  // ===========================================================================
  // QR CODE LIGHTBOX MODAL (ขยายภาพ QR Code ให้ใหญ่ขึ้น)
  // ===========================================================================
  function initQrLightboxModal() {
    function openQrLightbox(type = 'reg') {
      if (!qrLightboxModal) return;
      if (type === 'draw') {
        if (qrLightboxBadgeText) qrLightboxBadgeText.textContent = 'CHECK LUCKY DRAW RESULT';
        if (qrLightboxTitle) qrLightboxTitle.textContent = 'สแกน QR Code เพื่อตรวจสอบผลการจับรางวัล';
        if (qrLightboxDesc) qrLightboxDesc.textContent = 'สแกนเพื่อตรวจสอบรายชื่อผู้โชคดีและของรางวัลที่คุณได้รับในงาน';
      } else {
        if (qrLightboxBadgeText) qrLightboxBadgeText.textContent = 'SCAN TO REGISTER';
        if (qrLightboxTitle) qrLightboxTitle.textContent = 'สแกน QR Code เพื่อลงทะเบียน';
        if (qrLightboxDesc) qrLightboxDesc.textContent = 'เปิดกล้องมือถือแล้วสแกนเพื่อเข้าร่วมกิจกรรมและลุ้นรับของรางวัล';
      }
      if (qrLightboxImg) {
        qrLightboxImg.src = './images/qr-influ.png';
      }
      qrLightboxModal.style.display = 'flex';
    }

    function closeQrLightbox() {
      if (qrLightboxModal) {
        qrLightboxModal.style.display = 'none';
      }
    }

    // View 1 QR Code Frame & Img
    if (qrFrameView1) qrFrameView1.addEventListener('click', () => openQrLightbox('reg'));
    if (qrImageView1) qrImageView1.addEventListener('click', () => openQrLightbox('reg'));

    // Grand Draw Modal QR Code Frame & Img
    if (grandQrFrame) grandQrFrame.addEventListener('click', () => openQrLightbox('draw'));
    if (grandQrImg) grandQrImg.addEventListener('click', () => openQrLightbox('draw'));

    if (btnCloseQrLightbox) {
      btnCloseQrLightbox.addEventListener('click', closeQrLightbox);
    }
    if (qrLightboxModal) {
      qrLightboxModal.addEventListener('click', (e) => {
        if (e.target === qrLightboxModal) {
          closeQrLightbox();
        }
      });
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && qrLightboxModal && qrLightboxModal.style.display !== 'none') {
        closeQrLightbox();
      }
    });
  }

  // ===========================================================================
  // DRAW ROULETTE MODAL CONTROLLER
  // ===========================================================================
  function initRouletteModal() {
    if (btnCloseRoulette) {
      btnCloseRoulette.addEventListener('click', () => {
        if (state.isRouletteRunning) {
          if (!confirm("ระบบกำลังสุ่มรางวัลอยู่ คุณต้องการหยุดการสุ่มหรือไม่?")) return;
        }
        if (drawRouletteModal) {
          drawRouletteModal.style.display = 'none';
        }
        state.isRouletteRunning = false;
        renderPrizesGrid();
      });
    }
  }

  // ===========================================================================
  // MULTI-DEVICE REAL-TIME DRAW SYNCHRONIZATION (เชื่อมต่อการสุ่มข้ามทุกเครื่อง)
  // เมื่อเครื่องหลักกดสุ่ม เครื่องอื่น ๆ ในหน้าเดียวกันจะแสดงอนิเมชั่นและผลสุ่มแบบเดียวกัน
  // ===========================================================================

  /**
   * ส่งสัญญาณคำสั่งสุ่มรางวัลไปยังทุกเครื่องผ่าน Firestore และ BroadcastChannel
   * เชื่อมโยงผ่าน Room PIN เพื่อให้เครื่องที่รหัสตรงกันทำงานสอดคล้องกันข้ามเครื่อง
   */
  async function broadcastLiveDrawEvent(eventData) {
    if (!eventData) return;
    const currentPin = String(state.roomPin || 'AL2026').trim().toUpperCase();
    eventData.eventId = eventData.eventId || ('evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
    eventData.senderClientId = state.clientId;
    eventData.roomPin = currentPin;
    eventData.isControlDoc = true;
    eventData.timestamp = Date.now();
    state.lastHandledEventId = eventData.eventId;

    // 1. BroadcastChannel สำหรับแท็บหรือหน้าต่างในเครื่องเดียวกัน (Local 0ms)
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const chPin = new BroadcastChannel('AL_REALTIME_SYNC_' + currentPin);
        chPin.postMessage({
          type: 'LIVE_DRAW_SYNC',
          drawEvent: eventData
        });
        const chDef = new BroadcastChannel('AL_REALTIME_SYNC');
        chDef.postMessage({
          type: 'LIVE_DRAW_SYNC',
          drawEvent: eventData
        });
      } catch (e) {}
    }

    // 2. LocalStorage StorageEvent fallback (Local 0ms ข้ามแท็บ)
    try {
      localStorage.setItem('AL_LAST_DRAW_EVENT_' + currentPin, JSON.stringify(eventData));
    } catch (e) {}

    // 3. บันทึกลง Firestore AL_Reward/_CONTROL_{PIN}_ สำหรับทุกเครื่องที่เปิดอยู่ข้าม Network
    if (state.db) {
      try {
        const controlDocId = '_CONTROL_' + currentPin + '_';
        await state.db.collection('AL_Reward').doc(controlDocId).set(eventData);
      } catch (err) {
        console.warn("Firestore broadcast draw event error:", err);
      }
    }
  }

  /**
   * รับสัญญาณการสุ่มจากเครื่องหลัก และสั่งให้เครื่องนี้แสดงผลแบบเดียวกันด้วยผลสุ่มชุดเดียวกัน
   */
  async function handleIncomingDrawEvent(drawEvent) {
    if (!drawEvent || !drawEvent.eventId) return;

    // ตรวจสอบ Room PIN ต้องตรงกันเพื่อป้องกันการสั่งการข้ามห้อง
    const currentPin = String(state.roomPin || 'AL2026').trim().toUpperCase();
    const eventPin = String(drawEvent.roomPin || 'AL2026').trim().toUpperCase();
    if (eventPin !== currentPin) return;

    // ข้ามหากเป็นเครื่องที่เป็นผู้ส่งเอง
    if (drawEvent.senderClientId === state.clientId) return;
    // ข้ามหากได้รับและประมวลผลคำสั่งนี้ไปแล้ว
    if (drawEvent.eventId === state.lastHandledEventId) return;

    state.lastHandledEventId = drawEvent.eventId;
    unlockAudioContext();

    // จัดการสลับหน้าจอตามคำสั่งที่ได้รับ
    if (drawEvent.type === 'GROUP_SELECT' && (drawEvent.group === 'OVERVIEW' || drawEvent.group === 'MAIN')) {
      showView('registration', false);
      return;
    }

    if (drawEvent.type === 'FAST_DRAW') {
      closeGrandDrawModal();
      state.isRouletteRunning = true;
      if (btnExecuteAllDraw) btnExecuteAllDraw.disabled = true;
      if (state.activeView !== 'draw') {
        showView('draw');
      }
      if (drawEvent.group) {
        window.goToDrawByGroup(drawEvent.group, false);
      }
      await new Promise(r => setTimeout(r, 80));

      // แปลง boxes จาก FAST_DRAW เป็น steps เพื่อให้แสดง action การสุ่มเลือกเสมือนการสุ่มในเงื่อนไขการกดปุ่มสุ่มปกติ
      const steps = [];
      if (Array.isArray(drawEvent.boxes)) {
        drawEvent.boxes.forEach(box => {
          if (Array.isArray(box.winners)) {
            box.winners.forEach(w => {
              steps.push({
                stepIdx: steps.length,
                rewardIdx: box.rewardIdx,
                order: (w.reward && w.reward.order) || (box.rewardIdx + 1),
                prizeName: (w.reward && w.reward.prizeName) || 'ของรางวัล',
                imageUrl: (w.reward && w.reward.imageUrl) || '',
                reward: w.reward || {},
                candidate: w.candidate,
                time: w.time
              });
            });
          }
        });
        steps.forEach(s => s.totalSteps = steps.length);
      }

      if (steps.length > 0) {
        await runRouletteDrawAnimation(steps, false);
      } else {
        await runFastDrawAnimation(drawEvent.boxes, false);
      }
    } else if (drawEvent.type === 'ROULETTE_DRAW') {
      closeGrandDrawModal();
      state.isRouletteRunning = true;
      if (btnExecuteAllDraw) btnExecuteAllDraw.disabled = true;
      if (state.activeView !== 'draw') {
        showView('draw');
      }
      if (drawEvent.group) {
        window.goToDrawByGroup(drawEvent.group, false);
      }
      await new Promise(r => setTimeout(r, 80));
      await runRouletteDrawAnimation(drawEvent.steps, false);
    } else if (drawEvent.type === 'EXTRA_DRAW') {
      closeGrandDrawModal();
      state.isRouletteRunning = true;
      if (state.activeView !== 'draw') {
        showView('draw');
      }
      if (state.filterPrizeGroup !== 'Group Extra') {
        window.goToDrawByGroup('Group Extra', false);
      }
      await new Promise(r => setTimeout(r, 80));
      await runExtraDrawPlayback(drawEvent, false);
    } else if (drawEvent.type === 'EXTRA_RESET') {
      playbackFollowerExtraReset(drawEvent);
    } else if (drawEvent.type === 'GROUP_SELECT') {
      if (!state.isRouletteRunning && drawEvent.group) {
        if (drawEvent.group === 'OVERVIEW' || drawEvent.group === 'MAIN') {
          showView('registration', false);
        } else {
          window.goToDrawByGroup(drawEvent.group, false);
        }
      }
    } else if (drawEvent.type === 'EXTRA_SELECT') {
      if (!state.isRouletteRunning && drawEvent.rewardId) {
        if (state.filterPrizeGroup !== 'Group Extra') {
          window.goToDrawByGroup('Group Extra', false);
        }
        state.selectedExtraRewardId = drawEvent.rewardId;
        renderGroupExtraStage();
      }
    }
  }

  function playbackFollowerExtraReset(data) {
    if (data.clearedWinnerIds && Array.isArray(data.clearedWinnerIds)) {
      data.clearedWinnerIds.forEach(empId => {
        const found = state.employees.find(e => e.EmployeeID === empId);
        if (found) {
          found.RewardName = '';
          found.RewardOwner = '';
          found.RewardExecutive = '';
          found.RewardId = '';
          found.RewardGroup = '';
          found.RewardDrawTime = null;
          found.RewardTime = null;
          found.RewardStatus = 'ยังไม่ได้รับรางวัล';
        }
      });
    }
    renderGroupExtraStage();
    renderDrawGroupsFilterBar();
    updateEligiblePill();
    updateDisplay(false);
  }

  /**
   * เล่นอนิเมชั่นสุ่มเร็ว (Fast Draw) บนกล่องรางวัล
   */
  async function runFastDrawAnimation(boxes, isMaster = true) {
    if (!boxes || boxes.length === 0) return;
    state.isRouletteRunning = true;
    if (btnExecuteAllDraw) btnExecuteAllDraw.disabled = true;

    const newlyDrawn = [];
    const pool = getEligibleCandidates();

    for (let bIdx = 0; bIdx < boxes.length; bIdx++) {
      if (!state.isRouletteRunning) break;
      const boxItem = boxes[bIdx];
      let cardElem = findBoxCard(boxItem);
      if (cardElem) {
        cardElem.classList.add('is-drawing-now');
        cardElem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      setBoxDrawingActiveState(boxItem, true, `🎲⚡ กำลังสุ่ม ${boxItem.need} รางวัล...`);

      for (let k = 0; k < boxItem.winners.length; k++) {
        if (!state.isRouletteRunning) break;
        const wItem = boxItem.winners[k];
        const winnerCandidate = wItem.candidate;

        await runBoxShufflingAnimation(boxItem, pool, winnerCandidate);

        let empInState = state.employees.find(e => e.EmployeeID === winnerCandidate.EmployeeID);
        if (!empInState) {
          empInState = { ...winnerCandidate };
          state.employees.push(empInState);
        }
        empInState.RewardName = wItem.reward.prizeName;
        empInState.RewardId = wItem.reward.id;
        empInState.RewardOrder = wItem.reward.order;
        empInState.RewardGroup = wItem.reward.group || '';
        empInState.RewardOwner = wItem.reward.owner || '';
        empInState.RewardExecutive = wItem.reward.owner || '';
        empInState.RewardPosition = wItem.reward.ownerPosition || '';
        empInState.RewardOwnerPosition = wItem.reward.ownerPosition || '';
        empInState.RewardOwnerImage = wItem.reward.ownerImage || '';
        empInState.RewardImageUrl = wItem.reward.imageUrl || '';
        empInState.RewardDrawTime = wItem.time;
        empInState.RewardTime = wItem.time;
        empInState.RewardStatus = 'ยังไม่ได้รับรางวัล';
        newlyDrawn.push(empInState);
        state.latestWinnerId = empInState.EmployeeID;

        playPopChime();
        renderPrizesGrid();
        const activeCard = findBoxCard(boxItem);
        if (activeCard) activeCard.classList.add('is-drawing-now');
        setBoxDrawingActiveState(boxItem, true, `🎲⚡ กำลังสุ่ม (${k + 1}/${boxItem.need})...`);
        updateEligiblePill();
        await new Promise(r => setTimeout(r, 450));
      }

      const finishedCard = findBoxCard(boxItem);
      if (finishedCard) {
        finishedCard.classList.remove('is-drawing-now');
      }
      setBoxDrawingActiveState(boxItem, false);
      renderPrizesGrid();
      await new Promise(r => setTimeout(r, 500));
    }

    triggerGrandCelebrationFireworks();

    if (isMaster) {
      try {
        if (state.db && newlyDrawn.length > 0) {
          const batchPromises = newlyDrawn.map(w => {
            const docId = w.id || String(w.EmployeeID);
            return state.db.collection(state.collectionName).doc(docId).set({
              RewardName: w.RewardName,
              RewardId: w.RewardId || '',
              RewardOrder: w.RewardOrder || 0,
              RewardGroup: w.RewardGroup || '',
              RewardOwner: w.RewardOwner || '',
              RewardExecutive: w.RewardExecutive || '',
              RewardPosition: w.RewardPosition || '',
              RewardOwnerPosition: w.RewardOwnerPosition || '',
              RewardOwnerImage: w.RewardOwnerImage || '',
              RewardImageUrl: w.RewardImageUrl || '',
              RewardDrawTime: w.RewardDrawTime,
              RewardTime: w.RewardTime,
              RewardStatus: 'ยังไม่ได้รับรางวัล'
            }, { merge: true });
          });
          await Promise.allSettled(batchPromises);
        }
      } catch (err) {
        console.warn("Firestore batch draw error:", err);
      }
    }

    try {
      localStorage.setItem('AL_EMPLOYEES_DATA', JSON.stringify(state.employees));
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('AL_REALTIME_SYNC');
        channel.postMessage({
          type: 'DATABASE_SYNC',
          employees: state.employees
        });
      }
    } catch (e) {}

    checkAndBroadcastAllPrizesDrawn();
    checkAndBroadcastAllPrizesDrawn();
    state.isRouletteRunning = false;
    state.latestWinnerId = null;
    if (btnExecuteAllDraw) btnExecuteAllDraw.disabled = false;
    if (btnCloseGrandModal) btnCloseGrandModal.style.visibility = 'visible';
    renderPrizesGrid();
    renderModalPrizesList();
    renderRewardGroupsGrid();
    renderDrawGroupsFilterBar();
    updateEligiblePill();
    updateDisplay(false);
  }

  function checkAndBroadcastAllPrizesDrawn() {
    if (!state.db) return;
    try {
      const rewards = state.rewards || [];
      if (rewards.length === 0) return;
      const totalQty = rewards.reduce((sum, r) => sum + (Number(r.quantity) || 1), 0);
      const totalDrawn = (state.employees || []).filter(e => e.RewardName && e.RewardName !== '-' && String(e.RewardName).trim() !== '').length;
      if (totalDrawn >= totalQty && totalQty > 0) {
        const currentPin = String(state.roomPin || 'AL2026').trim().toUpperCase();
        state.db.collection('AL_Reward').doc('_CONTROL_' + currentPin + '_').set({
          allPrizesDrawn: true,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    } catch (e) {}
  }

  /**
   * เล่นอนิเมชั่นสุ่มแบบรูเล็ต (Roulette Draw)
   */
  async function runRouletteDrawAnimation(steps, isMaster = true) {
    if (!steps || steps.length === 0) return;
    state.isRouletteRunning = true;
    if (btnExecuteAllDraw) btnExecuteAllDraw.disabled = true;

    const totalDrawSteps = steps.length;
    const pool = getEligibleCandidates();
    const newlyDrawn = [];

    if (drawRouletteModal) {
      drawRouletteModal.style.display = 'flex';
    }

    const rollDuration = totalDrawSteps > 6 ? 750 : 1100;
    const revealDuration = totalDrawSteps > 6 ? 850 : 1300;

    for (let sIdx = 0; sIdx < totalDrawSteps; sIdx++) {
      if (!state.isRouletteRunning) break;
      const stepItem = steps[sIdx];
      const winnerCandidate = stepItem.candidate;

      if (roulettePrizeBadge) {
        roulettePrizeBadge.textContent = `🎁 สุ่มลำดับที่ ${stepItem.order} (ชิ้นที่ ${sIdx + 1}/${totalDrawSteps})`;
      }
      if (roulettePrizeTitle) {
        roulettePrizeTitle.textContent = stepItem.prizeName;
      }
      if (roulettePrizeThumb) {
        if (stepItem.imageUrl && stepItem.imageUrl.trim() !== '') {
          roulettePrizeThumb.innerHTML = `<img src="${escapeHtml(stepItem.imageUrl)}" alt="${escapeHtml(stepItem.prizeName)}" style="width:100%;height:100%;object-fit:contain;" onerror="this.parentElement.innerHTML='🎁';">`;
        } else {
          roulettePrizeThumb.innerHTML = '🎁';
        }
      }

      if (rouletteStageRolling) rouletteStageRolling.style.display = 'block';
      if (rouletteStageWinner) rouletteStageWinner.style.display = 'none';

      const safePool = (pool && pool.length > 0) ? pool : (state.employees && state.employees.length > 0 ? state.employees : [winnerCandidate]);

      let rollInterval = setInterval(() => {
        playTickSound();
        const randSample = safePool[Math.floor(Math.random() * safePool.length)] || winnerCandidate;
        const randName = (randSample.EmpName && randSample.EmpName !== '-') ? randSample.EmpName : 'พนักงาน ttb';
        if (rollingEmpId) rollingEmpId.textContent = randSample.EmployeeID || '-----';
        if (rollingEmpName) rollingEmpName.textContent = randName;
        if (rollingEmpInfo) rollingEmpInfo.textContent = `${randSample.Group || 'ttb'} ${randSample.Branch ? '| ' + randSample.Branch : ''}`;
      }, 50);

      await new Promise(r => setTimeout(r, rollDuration));
      clearInterval(rollInterval);

      const empNameDisplay = (winnerCandidate.EmpName && winnerCandidate.EmpName !== '-') ? winnerCandidate.EmpName : 'พนักงาน ttb';
      if (winnerHeroId) winnerHeroId.textContent = winnerCandidate.EmployeeID;
      if (winnerHeroName) winnerHeroName.textContent = empNameDisplay;
      if (winnerHeroDetails) {
        winnerHeroDetails.textContent = `กลุ่ม: ${winnerCandidate.Group || 'ttb'} ${winnerCandidate.Branch ? '| สาขา: ' + winnerCandidate.Branch : ''}`;
      }

      if (rouletteStageRolling) rouletteStageRolling.style.display = 'none';
      if (rouletteStageWinner) rouletteStageWinner.style.display = 'block';

      playWinnerFanfare();
      triggerSparkleCelebration();

      let empInState = state.employees.find(e => e.EmployeeID === winnerCandidate.EmployeeID);
      if (!empInState) {
        empInState = { ...winnerCandidate };
        state.employees.push(empInState);
      }
      empInState.RewardName = stepItem.prizeName;
      empInState.RewardId = stepItem.reward.id;
      empInState.RewardOrder = stepItem.order;
      empInState.RewardGroup = stepItem.reward.group || '';
      empInState.RewardOwner = stepItem.reward.owner || '';
      empInState.RewardExecutive = stepItem.reward.owner || '';
      empInState.RewardPosition = stepItem.reward.ownerPosition || '';
      empInState.RewardOwnerPosition = stepItem.reward.ownerPosition || '';
      empInState.RewardOwnerImage = stepItem.reward.ownerImage || '';
      empInState.RewardImageUrl = stepItem.reward.imageUrl || '';
      empInState.RewardDrawTime = stepItem.time;
      empInState.RewardTime = stepItem.time;
      empInState.RewardStatus = 'ยังไม่ได้รับรางวัล';
      newlyDrawn.push(empInState);
      state.latestWinnerId = empInState.EmployeeID;

      await new Promise(r => setTimeout(r, revealDuration));

      renderPrizesGrid();
      updateEligiblePill();
      await new Promise(r => setTimeout(r, 350));
    }

    if (drawRouletteModal) {
      drawRouletteModal.style.display = 'none';
    }

    triggerGrandCelebrationFireworks();

    if (isMaster) {
      try {
        if (state.db && newlyDrawn.length > 0) {
          const batchPromises = newlyDrawn.map(w => {
            const docId = w.id || String(w.EmployeeID);
            return state.db.collection(state.collectionName).doc(docId).set({
              RewardName: w.RewardName,
              RewardId: w.RewardId || '',
              RewardOrder: w.RewardOrder || 0,
              RewardGroup: w.RewardGroup || '',
              RewardOwner: w.RewardOwner || '',
              RewardExecutive: w.RewardExecutive || '',
              RewardPosition: w.RewardPosition || '',
              RewardOwnerPosition: w.RewardOwnerPosition || '',
              RewardOwnerImage: w.RewardOwnerImage || '',
              RewardImageUrl: w.RewardImageUrl || '',
              RewardDrawTime: w.RewardDrawTime,
              RewardTime: w.RewardTime,
              RewardStatus: 'ยังไม่ได้รับรางวัล'
            }, { merge: true });
          });
          await Promise.allSettled(batchPromises);
        }
      } catch (err) {
        console.warn("Firestore batch draw error:", err);
      }
    }

    try {
      localStorage.setItem('AL_EMPLOYEES_DATA', JSON.stringify(state.employees));
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('AL_REALTIME_SYNC');
        channel.postMessage({
          type: 'DATABASE_SYNC',
          employees: state.employees
        });
      }
    } catch (e) {}

    checkAndBroadcastAllPrizesDrawn();
    state.isRouletteRunning = false;
    state.latestWinnerId = null;
    if (btnExecuteAllDraw) btnExecuteAllDraw.disabled = false;
    if (btnCloseGrandModal) btnCloseGrandModal.style.visibility = 'visible';
    renderPrizesGrid();
    renderModalPrizesList();
    renderRewardGroupsGrid();
    renderDrawGroupsFilterBar();
    updateEligiblePill();
    updateDisplay(false);
  }

  // Execute All Draw (เครื่องหลัก Master ทำหน้าที่สุ่มเลือกรายชื่อและกระจายไปยังทุกเครื่อง):
  async function executeGrandDrawAll() {
    if (state.isRouletteRunning) return;

    const eligible = getEligibleCandidates();
    const rewards = getDisplayRewards();

    let totalNeeded = 0;
    const prizeQuotas = [];
    rewards.forEach((r, idx) => {
      const prizeName = String(r.name || `รางวัลที่ ${idx + 1}`).trim();
      const totalQty = Math.max(1, parseInt(r.quantity, 10) || 1);
      const winnersForThis = getWinnersForDisplayReward(r, idx, rewards);
      const alreadyWonCount = winnersForThis.length;
      const need = Math.max(0, totalQty - alreadyWonCount);
      prizeQuotas.push({
        reward: r,
        rewardIdx: idx,
        prizeName,
        order: idx + 1,
        totalQty,
        alreadyWonCount,
        need,
        imageUrl: r.imageUrl || ''
      });
      totalNeeded += need;
    });

    if (totalNeeded === 0) {
      alert("✅ สุ่มครบทุกรางวัล และครบทุกจำนวนของรางวัลที่มีทั้งหมดเรียบร้อยแล้ว!");
      return;
    }

    if (eligible.length === 0) {
      alert("⚠️ ไม่มีผู้มีสิทธิ์ลุ้นรางวัลที่ยังไม่ได้รับรางวัลในระบบ\n\nเงื่อนไข: ผู้มีสิทธิ์ต้องลงทะเบียนเข้าร่วมกิจกรรมแล้ว, มีชื่อพนักงาน (ฟิลด์ EmpName ไม่เป็น - หรือค่าว่าง หรือค่า null) และยังไม่เคยได้รับรางวัล");
      return;
    }

    closeGrandDrawModal();

    // สุ่มสลับผู้มีสิทธิ์ (Fisher-Yates Shuffle)
    const pool = [...eligible];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    if (state.drawMode === 'fast') {
      let poolIdx = 0;
      const drawEventBoxes = [];

      for (let bIdx = 0; bIdx < prizeQuotas.length; bIdx++) {
        const boxItem = prizeQuotas[bIdx];
        if (boxItem.need <= 0) continue;
        const boxWinners = [];
        for (let k = 0; k < boxItem.need; k++) {
          if (poolIdx >= pool.length) break;
          const winnerCandidate = pool[poolIdx++];
          const now = new Date();
          const formattedTime = `${now.getFullYear() + 543}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
          boxWinners.push({
            candidate: {
              EmployeeID: winnerCandidate.EmployeeID,
              EmpName: winnerCandidate.EmpName,
              Group: winnerCandidate.Group,
              Branch: winnerCandidate.Branch,
              id: winnerCandidate.id || String(winnerCandidate.EmployeeID)
            },
            reward: {
              prizeName: boxItem.prizeName,
              id: boxItem.reward.id || ('idx_' + boxItem.rewardIdx),
              order: boxItem.order,
              group: boxItem.reward.group || '',
              owner: boxItem.reward.owner || '',
              ownerPosition: boxItem.reward.ownerPosition || boxItem.reward.position || boxItem.reward.executivePosition || '',
              ownerImage: boxItem.reward.ownerImage || boxItem.reward.ownerImageUrl || boxItem.reward.executiveImage || '',
              imageUrl: boxItem.reward.imageUrl || boxItem.imageUrl || ''
            },
            time: formattedTime
          });
        }
        if (boxWinners.length > 0) {
          drawEventBoxes.push({
            rewardIdx: boxItem.rewardIdx,
            need: boxItem.need,
            winners: boxWinners
          });
        }
      }

      // กระจายผลการสุ่มไปยังทุกเครื่อง
      await broadcastLiveDrawEvent({
        type: 'FAST_DRAW',
        group: state.filterPrizeGroup,
        boxes: drawEventBoxes
      });

      // เล่นอนิเมชั่นบนเครื่อง Master
      await runFastDrawAnimation(drawEventBoxes, true);
    } else {
      const drawQueue = [];
      prizeQuotas.forEach(boxItem => {
        for (let k = 0; k < boxItem.need; k++) {
          drawQueue.push({
            reward: boxItem.reward,
            rewardIdx: boxItem.rewardIdx,
            prizeName: boxItem.prizeName,
            order: boxItem.order,
            imageUrl: boxItem.imageUrl,
            totalQty: boxItem.totalQty
          });
        }
      });

      const totalDrawSteps = Math.min(drawQueue.length, pool.length);
      const drawEventSteps = [];
      for (let stepIdx = 0; stepIdx < totalDrawSteps; stepIdx++) {
        const currentItem = drawQueue[stepIdx];
        const winnerCandidate = pool[stepIdx];
        const now = new Date();
        const formattedTime = `${now.getFullYear() + 543}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        drawEventSteps.push({
          stepIdx,
          totalSteps: totalDrawSteps,
          rewardIdx: currentItem.rewardIdx,
          order: currentItem.order,
          prizeName: currentItem.prizeName,
          imageUrl: currentItem.imageUrl || '',
          reward: {
            id: currentItem.reward.id || ('idx_' + currentItem.rewardIdx),
            group: currentItem.reward.group || '',
            owner: currentItem.reward.owner || '',
            ownerPosition: currentItem.reward.ownerPosition || currentItem.reward.position || currentItem.reward.executivePosition || '',
            ownerImage: currentItem.reward.ownerImage || currentItem.reward.ownerImageUrl || currentItem.reward.executiveImage || '',
            imageUrl: currentItem.reward.imageUrl || currentItem.imageUrl || ''
          },
          candidate: {
            EmployeeID: winnerCandidate.EmployeeID,
            EmpName: winnerCandidate.EmpName,
            Group: winnerCandidate.Group,
            Branch: winnerCandidate.Branch,
            id: winnerCandidate.id || String(winnerCandidate.EmployeeID)
          },
          time: formattedTime
        });
      }

      // กระจายผลการสุ่มไปยังทุกเครื่อง
      await broadcastLiveDrawEvent({
        type: 'ROULETTE_DRAW',
        group: state.filterPrizeGroup,
        steps: drawEventSteps
      });

      // เล่นอนิเมชั่นบนเครื่อง Master
      await runRouletteDrawAnimation(drawEventSteps, true);
    }
  }

  // ===========================================================================
  // PRIZE DETAIL LIGHTBOX MODAL (ดูรายละเอียดของรางวัลเมื่อคลิกรูป)
  // ===========================================================================
  function initPrizeDetailModal() {
    if (btnClosePrizeDetail) {
      btnClosePrizeDetail.addEventListener('click', closePrizeDetailModal);
    }
    if (prizeDetailModal) {
      prizeDetailModal.addEventListener('click', (e) => {
        if (e.target === prizeDetailModal) {
          closePrizeDetailModal();
        }
      });
    }
  }

  function closePrizeDetailModal() {
    if (prizeDetailModal) {
      prizeDetailModal.style.display = 'none';
    }
  }

  window.showPrizeDetailsModal = function (prizeName, rewardIdx) {
    const rewards = getDisplayRewards();
    const targetReward = rewards[rewardIdx] || rewards.find(r => String(r.name).trim().toLowerCase() === String(prizeName).trim().toLowerCase()) || {
      order: rewardIdx + 1,
      name: prizeName,
      quantity: 5,
      imageUrl: ''
    };

    const totalQty = Number(targetReward.quantity) || 1;
    const cleanName = String(targetReward.name || prizeName).trim();

    // Find winners
    const winners = getWinnersForDisplayReward(targetReward, rewardIdx, rewards);
    const remaining = Math.max(0, totalQty - winners.length);

    if (detailModalOrderBadge) {
      detailModalOrderBadge.textContent = `ลำดับที่ ${rewardIdx + 1}`;
    }
    if (detailModalTitle) {
      detailModalTitle.textContent = cleanName;
    }
    if (detailModalQtyPill) {
      detailModalQtyPill.textContent = `จำนวน ${totalQty} รางวัล`;
    }
    if (detailModalRemainPill) {
      detailModalRemainPill.textContent = remaining === 0 ? `สุ่มครบแล้ว (${winners.length}/${totalQty})` : `คงเหลือ ${remaining} รางวัล (สุ่มแล้ว ${winners.length})`;
      detailModalRemainPill.className = remaining === 0 ? 'detail-meta-pill pill-remain' : 'detail-meta-pill';
    }

    if (detailModalImg) {
      if (targetReward.imageUrl && targetReward.imageUrl.trim() !== '') {
        detailModalImg.src = targetReward.imageUrl;
        detailModalImg.style.display = 'block';
      } else {
        detailModalImg.src = './images/qr-influ.png';
        detailModalImg.style.display = 'block';
      }
    }

    if (detailModalWinnersList) {
      if (winners.length > 0) {
        detailModalWinnersList.innerHTML = winners.map((w) => {
          const empNameDisplay = (w.EmpName && w.EmpName !== '-') ? w.EmpName : 'พนักงาน ttb';
          const grpText = w.Group ? `(${w.Group})` : '';
          const timeDisplay = w.RewardDrawTime ? (w.RewardDrawTime.split(' ')[1] || 'สุ่มแล้ว') : 'สุ่มแล้ว';
          const isClaimed = w.RewardStatus === 'รับรางวัลแล้ว' || w.RewardStatus === 'ได้รับรางวัลแล้ว';
          return `
            <div class="winner-item-pill ${isClaimed ? 'is-claimed' : ''}" 
                 onclick="window.showWinnerClaimModal('${escapeHtml(w.EmployeeID)}')" 
                 style="cursor: pointer;" 
                 title="คลิกเพื่อดูข้อมูลพนักงานและยืนยันการรับรางวัล">
              <div class="winner-item-left">
                <span class="winner-icon">${isClaimed ? '🎁' : '🏆'}</span>
                <span class="winner-id-bold">${escapeHtml(w.EmployeeID)}</span>
                <span class="winner-name-text">${escapeHtml(empNameDisplay)} ${escapeHtml(grpText)}</span>
              </div>
              <span class="winner-time-tag">${isClaimed ? '✓ รับรางวัลแล้ว' : escapeHtml(timeDisplay)}</span>
            </div>
          `;
        }).join('');
      } else {
        detailModalWinnersList.innerHTML = `
          <div style="text-align: center; color: rgba(255,255,255,0.5); font-size: 0.85rem; padding: 12px 0;">
            ⏳ ยังไม่มีผู้ได้รับรางวัลนี้ (รอการสุ่มรางวัล)
          </div>
        `;
      }
    }

    if (prizeDetailModal) {
      prizeDetailModal.style.display = 'flex';
    }
  };

  // ===========================================================================
  // WINNER CLAIM LIGHTBOX MODAL (ข้อมูลผู้ได้รับรางวัล และ ยืนยันการรับรางวัล)
  // ===========================================================================
  let currentClaimEmpId = null;

  function initWinnerClaimModal() {
    if (btnCloseWinnerClaim) {
      btnCloseWinnerClaim.addEventListener('click', closeWinnerClaimModal);
    }
    if (winnerClaimModal) {
      winnerClaimModal.addEventListener('click', (e) => {
        if (e.target === winnerClaimModal) {
          closeWinnerClaimModal();
        }
      });
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && winnerClaimModal && winnerClaimModal.style.display !== 'none') {
        closeWinnerClaimModal();
      }
    });

    if (btnConfirmClaim) {
      btnConfirmClaim.addEventListener('click', handleConfirmClaimReward);
    }
    if (btnCancelClaimStatus) {
      btnCancelClaimStatus.addEventListener('click', handleCancelClaimReward);
    }
  }

  function closeWinnerClaimModal() {
    if (winnerClaimModal) {
      winnerClaimModal.style.display = 'none';
    }
    currentClaimEmpId = null;
  }

  window.showWinnerClaimModal = function (employeeId) {
    if (!employeeId) return;
    const cleanId = String(employeeId).trim();
    const emp = state.employees.find(e => String(e.EmployeeID).trim() === cleanId);
    if (!emp) {
      alert("ไม่พบข้อมูลพนักงานรหัส: " + employeeId);
      return;
    }

    currentClaimEmpId = cleanId;

    // หาข้อมูลของรางวัล
    const rewards = getDisplayRewards();
    const prizeName = String(emp.RewardName || 'ของรางวัล').trim();
    let matchedReward = rewards.find(r => r.name && String(r.name).trim().toLowerCase() === prizeName.toLowerCase());
    if (!matchedReward) {
      matchedReward = rewards.find(r => r.name && (prizeName.toLowerCase().includes(String(r.name).trim().toLowerCase()) || String(r.name).trim().toLowerCase().includes(prizeName.toLowerCase())));
    }
    if (!matchedReward) {
      const matchOrder = prizeName.match(/รางวัลที่\s*(\d+)/);
      if (matchOrder) {
        const orderNum = parseInt(matchOrder[1], 10);
        matchedReward = rewards.find(r => Number(r.order) === orderNum);
      }
    }

    const isClaimed = emp.RewardStatus === 'รับรางวัลแล้ว' || emp.RewardStatus === 'ได้รับรางวัลแล้ว';
    const empNameDisplay = (emp.EmpName && emp.EmpName !== '-') ? emp.EmpName : 'พนักงาน ttb';
    const drawTimeDisplay = emp.RewardDrawTime || emp.RewardTime || 'สุ่มในระบบแล้ว';
    const claimedTimeDisplay = emp.RewardClaimedTime || emp.RewardTime || '-';

    // Update Modal DOM
    if (claimModalEmpId) claimModalEmpId.textContent = emp.EmployeeID;
    if (claimModalEmpName) claimModalEmpName.textContent = empNameDisplay;
    if (claimModalEmpGroup) claimModalEmpGroup.textContent = emp.Group || '-';
    if (claimModalEmpMember) claimModalEmpMember.textContent = emp.Member || '-';
    if (claimModalEmpBranch) claimModalEmpBranch.textContent = emp.EmpBranch || emp.Branch || '-';
    if (claimModalDrawTime) claimModalDrawTime.textContent = drawTimeDisplay;

    if (claimModalPrizeName) claimModalPrizeName.textContent = prizeName;
    if (claimModalPrizeOrder) {
      const displayIdx = matchedReward ? rewards.indexOf(matchedReward) : -1;
      claimModalPrizeOrder.textContent = displayIdx >= 0 ? `ลำดับที่ ${displayIdx + 1}` : 'ของรางวัล';
    }

    if (claimModalPrizeImgWrap) {
      if (matchedReward && matchedReward.imageUrl && matchedReward.imageUrl.trim() !== '') {
        claimModalPrizeImgWrap.innerHTML = `<img src="${escapeHtml(matchedReward.imageUrl)}" alt="${escapeHtml(prizeName)}" class="claim-prize-img" onerror="this.onerror=null; this.parentElement.innerHTML='<span style=\\'font-size: 2rem;\\'>🎁</span>';">`;
      } else {
        claimModalPrizeImgWrap.innerHTML = `<span style="font-size: 2rem;">🎁</span>`;
      }
    }

    // Status Pill & Action Buttons
    if (claimModalStatusPill && claimModalStatusText) {
      if (isClaimed) {
        claimModalStatusPill.className = 'claim-status-pill status-claimed';
        claimModalStatusText.textContent = 'รับรางวัลแล้ว';
      } else {
        claimModalStatusPill.className = 'claim-status-pill status-pending';
        claimModalStatusText.textContent = 'ยังไม่ได้รับรางวัล';
      }
    }

    if (claimModalClaimedRow) {
      if (isClaimed) {
        claimModalClaimedRow.style.display = 'flex';
        if (claimModalClaimedTime) claimModalClaimedTime.textContent = claimedTimeDisplay;
      } else {
        claimModalClaimedRow.style.display = 'none';
      }
    }

    if (btnConfirmClaim && btnConfirmClaimText) {
      if (isClaimed) {
        btnConfirmClaim.disabled = true;
        btnConfirmClaimText.textContent = '✓ บันทึกรับรางวัลเรียบร้อยแล้ว';
      } else {
        btnConfirmClaim.disabled = false;
        btnConfirmClaimText.textContent = 'ยืนยันการรับรางวัล';
      }
    }

    if (btnCancelClaimStatus) {
      btnCancelClaimStatus.style.display = isClaimed ? 'inline-block' : 'none';
    }

    if (claimNoticeHint) {
      claimNoticeHint.textContent = isClaimed
        ? 'พนักงานท่านนี้ได้รับมอบของรางวัลเรียบร้อยแล้ว'
        : '⚠️ กรุณาตรวจสอบความถูกต้องก่อนกดยืนยันการรับรางวัล';
    }

    if (winnerClaimModal) {
      winnerClaimModal.style.display = 'flex';
    }
  };

  async function handleConfirmClaimReward() {
    if (!currentClaimEmpId) return;
    const cleanId = String(currentClaimEmpId).trim();
    const emp = state.employees.find(e => String(e.EmployeeID).trim() === cleanId);
    if (!emp) return;

    const now = new Date();
    const formattedTime = `${now.getFullYear() + 543}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    emp.RewardStatus = 'รับรางวัลแล้ว';
    emp.RewardClaimedTime = formattedTime;

    // Save to Firestore
    if (state.db) {
      try {
        const docId = emp.id || cleanId;
        await state.db.collection(state.collectionName).doc(docId).set({
          RewardStatus: 'รับรางวัลแล้ว',
          RewardClaimedTime: formattedTime
        }, { merge: true });
      } catch (err) {
        console.warn("Firestore claim error:", err);
      }
    }

    // Save to LocalStorage & Broadcast
    try {
      localStorage.setItem('AL_EMPLOYEES_DATA', JSON.stringify(state.employees));
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('AL_REALTIME_SYNC');
        channel.postMessage({
          type: 'DATABASE_SYNC',
          employees: state.employees
        });
      }
    } catch (err) {}

    triggerSparkleCelebration();
    renderPrizesGrid();
    renderModalPrizesList();

    // Re-update modal to show claimed state, then close after 600ms
    window.showWinnerClaimModal(cleanId);
    setTimeout(() => {
      closeWinnerClaimModal();
    }, 600);
  }

  async function handleCancelClaimReward() {
    if (!currentClaimEmpId) return;
    if (!confirm("คุณต้องการยกเลิกสถานะการรับรางวัลของพนักงานท่านนี้ใช่หรือไม่?")) return;

    const cleanId = String(currentClaimEmpId).trim();
    const emp = state.employees.find(e => String(e.EmployeeID).trim() === cleanId);
    if (!emp) return;

    emp.RewardStatus = 'ยังไม่ได้รับรางวัล';
    emp.RewardClaimedTime = null;

    // Save to Firestore
    if (state.db) {
      try {
        const docId = emp.id || cleanId;
        await state.db.collection(state.collectionName).doc(docId).set({
          RewardStatus: 'ยังไม่ได้รับรางวัล',
          RewardClaimedTime: null
        }, { merge: true });
      } catch (err) {
        console.warn("Firestore unclaim error:", err);
      }
    }

    // Save to LocalStorage & Broadcast
    try {
      localStorage.setItem('AL_EMPLOYEES_DATA', JSON.stringify(state.employees));
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('AL_REALTIME_SYNC');
        channel.postMessage({
          type: 'DATABASE_SYNC',
          employees: state.employees
        });
      }
    } catch (err) {}

    renderPrizesGrid();
    renderModalPrizesList();
    closeWinnerClaimModal();
  }

  // ===========================================================================
  // REAL-TIME BROADCAST & STORAGE LISTENERS
  // ===========================================================================
  let realtimeChannelWithPin = null;

  function initRealtimeListeners() {
    const currentPin = String(state.roomPin || 'AL2026').trim().toUpperCase();

    // 1. BroadcastChannel between tabs (ฟังทั้งห้องกลาง และห้องระบุ PIN)
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const handleMsg = (e) => {
          if (!e.data) return;
          if (e.data.type === 'LIVE_DRAW_SYNC' && e.data.drawEvent) {
            handleIncomingDrawEvent(e.data.drawEvent);
          } else if (e.data.type === 'DATABASE_SYNC' && Array.isArray(e.data.employees)) {
            if (!state.isRouletteRunning) {
              state.employees = e.data.employees;
              updateDisplay(true);
            }
          } else if (e.data.type === 'NEW_REGISTRATION' || e.data.type === 'EMPLOYEE_REGISTERED') {
            const empId = String(e.data.employeeId).trim();
            const target = state.employees.find(x => String(x.EmployeeID).trim() === empId);
            if (target) {
              target.isRegistered = true;
              target.registeredAt = e.data.timestamp;
            } else {
              state.employees.unshift({
                EmployeeID: empId,
                EmpName: e.data.empName || '-',
                EmpPosition: e.data.empPosition || '-',
                EmpBranch: e.data.empBranch || '-',
                EmpZone: e.data.empZone || '-',
                EmpRH: e.data.empRH || 'RH5',
                Group: e.data.group || '',
                Member: e.data.member || '',
                isRegistered: true,
                registeredAt: e.data.timestamp
              });
            }
            updateDisplay(true);
          } else if (e.data.type === 'DRAW_BUTTONS_CONFIG' && e.data.config) {
            applyDrawButtonsConfig(e.data.config);
          }
        };

        const channelDef = new BroadcastChannel('AL_REALTIME_SYNC');
        channelDef.onmessage = handleMsg;

        if (realtimeChannelWithPin) {
          try { realtimeChannelWithPin.close(); } catch (err) {}
        }
        realtimeChannelWithPin = new BroadcastChannel('AL_REALTIME_SYNC_' + currentPin);
        realtimeChannelWithPin.onmessage = handleMsg;

        const rewChannel = new BroadcastChannel('AL_REWARDS_SYNC');
        rewChannel.onmessage = (e) => {
          loadRewardsFromLocalStorage();
          renderPrizesGrid();
        };
      } catch (e) {}
    }

    // 2. LocalStorage Storage Event (Local 0ms ข้ามแท็บ)
    window.addEventListener('storage', (e) => {
      if (e.key && e.key.startsWith('AL_LAST_DRAW_EVENT_')) {
        try {
          const drawEvent = JSON.parse(e.newValue);
          if (drawEvent) handleIncomingDrawEvent(drawEvent);
        } catch (err) {}
      } else if (e.key === 'AL_EMPLOYEES_DATA') {
        if (!state.isRouletteRunning) {
          loadFromLocalStorage();
        }
      } else if (e.key === 'AL_REWARDS_DATA') {
        loadRewardsFromLocalStorage();
        renderPrizesGrid();
      } else if (e.key === 'AL_DRAW_BUTTON_SETTINGS') {
        try {
          const config = JSON.parse(e.newValue);
          applyDrawButtonsConfig(config);
        } catch (err) {}
      }
    });
  }

  // ===========================================================================
  // FIREBASE SERVICE & FIRESTORE REAL-TIME LISTENER
  // ===========================================================================
  function initFirebaseService() {
    try {
      if (typeof window.initFirebase === 'function') {
        const fb = window.initFirebase();
        if (fb && fb.db) {
          state.db = fb.db;
          listenToFirestore();
          listenToRewardsFirestore();
          listenToLiveControlFirestore();
          startStageHeartbeat();
          updateRoomPinUI();
          return;
        }
      }
    } catch (err) {
      console.warn("Firebase initialization note:", err);
    }

    // Fallback if Firebase not ready
    loadFromLocalStorage();
    loadRewardsFromLocalStorage();
    updateConnStatusUI(true, "Real-time Live (Local)");
  }

  let isInitialControlSnapshot = true;
  function listenToLiveControlFirestore() {
    if (!state.db) return;

    if (state.unsubscribeControlSnapshot) {
      state.unsubscribeControlSnapshot();
    }

    const currentPin = String(state.roomPin || 'AL2026').trim().toUpperCase();
    const controlDocId = '_CONTROL_' + currentPin + '_';
    isInitialControlSnapshot = true;

    state.unsubscribeControlSnapshot = state.db.collection('AL_Reward')
      .doc(controlDocId)
      .onSnapshot((doc) => {
        if (doc && doc.exists) {
          const data = doc.data();
          if (isInitialControlSnapshot) {
            isInitialControlSnapshot = false;
            // บันทึก eventId ล่าสุดที่ค้างอยู่ใน Firestore เพื่อไม่ให้สุ่มซ้ำเมื่อเพิ่งโหลดหน้าเว็บ
            if (data && data.eventId) {
              state.lastHandledEventId = data.eventId;
            }
            return;
          }
          handleIncomingDrawEvent(data);
        } else {
          isInitialControlSnapshot = false;
        }
      }, (err) => {
        console.warn("Control firestore listener warning:", err);
      });
  }

  function startStageHeartbeat() {
    if (!state.db) return;
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);

    const sendBeat = async () => {
      try {
        const currentPin = String(state.roomPin || 'AL2026').trim().toUpperCase();
        const stageDocId = '_STAGE_ONLINE_' + currentPin + '_';
        await state.db.collection('AL_Reward').doc(stageDocId).set({
          roomPin: currentPin,
          isControlDoc: true,
          screen: 'random.html',
          lastActiveTime: Date.now(),
          activeView: state.activeView,
          filterPrizeGroup: state.filterPrizeGroup,
          clientId: state.clientId
        });
      } catch (e) {}
    };

    sendBeat();
    state.heartbeatTimer = setInterval(sendBeat, 4000);
  }

  window.promptChangeRoomPin = function() {
    const currentPin = String(state.roomPin || 'AL2026').trim().toUpperCase();
    const newPin = prompt("🔑 กำหนดรหัสห้องเชื่อมต่อ (Room PIN) สำหรับการสั่งการจากรีโมต:\n\n* รีโมตและหน้าจอนี้ต้องใส่รหัสตรงกันเพื่อสั่งงานข้ามเครื่องได้", currentPin);
    if (!newPin) return;
    const cleanPin = String(newPin).trim().toUpperCase();
    if (cleanPin === currentPin) return;
    
    state.roomPin = cleanPin;
    try {
      localStorage.setItem('AL_ROOM_PIN', cleanPin);
    } catch (e) {}

    updateRoomPinUI();
    initRealtimeListeners();
    listenToLiveControlFirestore();
    startStageHeartbeat();
    alert(`✅ กำหนดรหัสห้องเป็น: ${cleanPin} เรียบร้อยแล้ว\nกรุณาใส่รหัสห้อง ${cleanPin} บนหน้ารีโมต (remote-reward.html) เพื่อเชื่อมต่อ`);
  };

  function updateRoomPinUI() {
    const el = document.getElementById('randomRoomPinText');
    if (el) el.textContent = state.roomPin || 'AL2026';
  }

  function listenToFirestore() {
    if (!state.db) return;

    if (state.unsubscribeSnapshot) {
      state.unsubscribeSnapshot();
    }

    updateConnStatusUI(true, "กำลังเชื่อมต่อ Real-time...");

    const targetCollection = (window.DB_PATHS && window.DB_PATHS.AL_EMPLOYEE) ? window.DB_PATHS.AL_EMPLOYEE : state.collectionName;

    state.unsubscribeSnapshot = state.db.collection(targetCollection)
      .onSnapshot((snapshot) => {
        if (state.isRouletteRunning) {
          // หากกำลังเล่นอนิเมชั่นสุ่มรางวัลพร้อมกันอยู่ ไม่ให้ snapshot แทรกแซงหรือกระตุก
          return;
        }
        if (snapshot.empty) {
          loadFromLocalStorage();
        } else {
          const list = [];
          snapshot.forEach(doc => {
            list.push({ id: doc.id, ...doc.data() });
          });
          state.employees = list;
          try {
            localStorage.setItem('AL_EMPLOYEES_DATA', JSON.stringify(list));
          } catch (e) {}
        }

        updateConnStatusUI(true, "Real-time Live (Firestore)");
        updateDisplay(true);
      }, (error) => {
        console.warn("Firestore listener warning:", error);
        updateConnStatusUI(false, "โหมด Local Cache");
        loadFromLocalStorage();
      });
  }

  function listenToRewardsFirestore() {
    if (!state.db) return;

    if (state.unsubscribeRewardsSnapshot) {
      state.unsubscribeRewardsSnapshot();
    }

    state.unsubscribeRewardsSnapshot = state.db.collection(state.rewardsCollection)
      .orderBy('order', 'asc')
      .onSnapshot((snapshot) => {
        if (!snapshot.empty) {
          const list = [];
          snapshot.forEach(doc => {
            if (doc.id.startsWith('_') || (doc.data() && doc.data().isControlDoc)) return;
            list.push({ id: doc.id, ...doc.data() });
          });
          list.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
          state.rewards = list;
          try {
            localStorage.setItem('AL_REWARDS_DATA', JSON.stringify(list));
          } catch (e) {}
        } else {
          loadRewardsFromLocalStorage();
        }
        renderPrizesGrid();
        renderRewardGroupsGrid();
        renderDrawGroupsFilterBar();
      }, (err) => {
        console.warn("Rewards firestore warning:", err);
        loadRewardsFromLocalStorage();
        renderPrizesGrid();
        renderRewardGroupsGrid();
        renderDrawGroupsFilterBar();
      });
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem('AL_EMPLOYEES_DATA');
      if (raw) {
        state.employees = JSON.parse(raw);
      }
    } catch (e) {
      state.employees = [];
    }
    updateDisplay(false);
  }

  function loadRewardsFromLocalStorage() {
    try {
      const raw = localStorage.getItem('AL_REWARDS_DATA');
      if (raw) {
        state.rewards = JSON.parse(raw);
        return;
      }
    } catch (e) {}
    state.rewards = [];
  }

  function initLocalFallback() {
    loadFromLocalStorage();
    loadRewardsFromLocalStorage();
  }

  function updateConnStatusUI(connected, text) {
    if (!elConnStatus) return;
    const textEl = elConnStatus.querySelector('.status-text');
    const dotEl = elConnStatus.querySelector('.status-pulse-dot');

    if (textEl) textEl.textContent = text || 'Real-time Live';
    if (dotEl) {
      dotEl.style.background = connected ? '#10b981' : '#f59e0b';
      dotEl.style.boxShadow = connected ? '0 0 12px #10b981' : '0 0 12px #f59e0b';
    }
  }

  // ===========================================================================
  // FULLSCREEN TOGGLE
  // ===========================================================================
  function initFullscreenToggle() {
    if (!btnFullscreen) return;

    btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
          console.warn("Error attempting fullscreen:", err);
        });
        btnFullscreen.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>
          </svg>
          <span>ย่อจอ</span>
        `;
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        }
        btnFullscreen.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
          </svg>
          <span>เต็มจอ</span>
        `;
      }
    });

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && btnFullscreen) {
        btnFullscreen.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
          </svg>
          <span>เต็มจอ</span>
        `;
      }
    });
  }

})();
