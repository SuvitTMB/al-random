/**
 * AL Drive Forum Special - Remote Reward Controller
 * Remote controller interface for synchronizing and executing lucky draws across all random.html screens.
 */

(function () {
  'use strict';

  const state = {
    db: null,
    rewardsCollection: 'AL_Reward',
    employeesCollection: 'AL_Employee',
    controlCollection: 'AL_Reward', // ใช้ AL_Reward เพื่อให้สิทธิ์ผ่านตาม Firebase Security Rules
    roomPin: (function() {
      try {
        return localStorage.getItem('AL_ROOM_PIN') || 'AL2026';
      } catch (e) {
        return 'AL2026';
      }
    })(),
    unsubscribeStageHeartbeat: null,
    rewards: [],
    employees: [],
    selectedGroup: null,
    selectedExtraRewardId: null,
    pendingGroupDrawMode: null,
    pendingExtraDrawRewardId: null,
    pendingRedrawRewardId: null,
    isProcessing: false,
    clientId: 'remote_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)
  };

  // Helper: Escape HTML
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Toast Notification
  function showToast(msg, duration = 3000) {
    const toast = document.getElementById('remoteToast');
    if (!toast) return;
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, duration);
  }

  // Compare reward groups for sorting (identical to random.js & admin.js)
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

  // ===========================================================================
  // CANDIDATE ELIGIBILITY RULES
  // 1. ตรวจสอบฟิวด์ Member ไม่ใช่ค่าว่าง หรือค่า null
  // 2. ฟิลด์ EmpName ไม่เท่ากับ - หรือค่าว่าง หรือค่า null
  // 3. ยังไม่เคยได้รับรางวัลมาก่อนหน้านี้
  // ===========================================================================
  function hasEmpNameText(empName) {
    if (empName === undefined || empName === null) return false;
    const s = String(empName).trim();
    return s !== '' && s !== '-' && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined';
  }

  function isMemberEligible(emp) {
    if (!emp) return false;
    const m = emp.Member;
    if (m === undefined || m === null) return false;
    const s = String(m).trim();
    return s !== '' && s !== '-' && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined';
  }

  function getEligibleCandidates() {
    return state.employees.filter(emp => {
      if (!isMemberEligible(emp)) return false;
      if (!hasEmpNameText(emp.EmpName)) return false;
      if (emp.RewardName && emp.RewardName !== '-' && String(emp.RewardName).trim() !== '') return false;
      return true;
    });
  }

  // Count drawn for a prize
  function getDrawnCountForPrize(reward) {
    if (!reward) return 0;
    const rId = String(reward.id || '').trim();
    const rOwner = String(reward.owner || '').trim().replace(/^คุณ\s*/, '').toLowerCase();
    const rName = String(reward.name || '').trim().toLowerCase();

    return state.employees.filter(e => {
      if (!e || !e.RewardName) return false;
      const eName = String(e.RewardName).trim().toLowerCase();
      if (eName !== rName) return false;

      if (rId && e.RewardId && String(e.RewardId).trim() === rId) return true;

      const eOwner = String(e.RewardOwner || e.RewardExecutive || '').trim().replace(/^คุณ\s*/, '').toLowerCase();
      if (rOwner && eOwner && eOwner === rOwner) return true;

      if (!rOwner && !eOwner) return true;
      return false;
    }).length;
  }

  // Get active groups summarized
  function getActiveRewardGroups() {
    const list = state.rewards || [];
    const groupMap = new Map();

    list.forEach(r => {
      if (!r) return;
      const grp = String(r.group || '').trim();
      const name = String(r.name || '').trim();
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

      const item = groupMap.get(grp);
      if (!item.groupName && r.groupName && String(r.groupName).trim() !== '') {
        item.groupName = String(r.groupName).trim();
      }

      const qty = parseInt(r.quantity, 10) || 1;
      const drawn = getDrawnCountForPrize(r);
      const remain = Math.max(0, qty - drawn);

      item.prizes.push({
        reward: r,
        name: name,
        qty: qty,
        drawn: drawn,
        remain: remain
      });

      item.totalQty += qty;
      item.drawnQty += drawn;
      item.remainQty += remain;
    });

    const groupsArr = Array.from(groupMap.values());
    groupsArr.forEach(g => {
      g.isComplete = g.remainQty <= 0 && g.totalQty > 0;
    });

    groupsArr.sort(compareRewardGroups);
    return groupsArr;
  }

  // ===========================================================================
  // REAL-TIME BROADCAST TO ALL SCREENS (random.html)
  // ส่งสัญญาณไปยัง AL_Reward/_CONTROL_{PIN}_ และ _CONTROL_GLOBAL_ เพื่อให้ส่งข้ามเครื่องได้จริง 100%
  // ===========================================================================
  async function broadcastLiveDrawEvent(eventData) {
    if (!eventData) return;
    const currentPin = String(state.roomPin || 'AL2026').trim().toUpperCase();
    eventData.eventId = 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    eventData.senderClientId = state.clientId;
    eventData.roomPin = currentPin;
    eventData.isControlDoc = true;
    eventData.timestamp = Date.now();

    // 1. BroadcastChannel (Local 0ms) - ส่งทั้งห้องเฉพาะและห้องกลาง
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
        const chGlob = new BroadcastChannel('AL_REALTIME_SYNC_GLOBAL');
        chGlob.postMessage({
          type: 'LIVE_DRAW_SYNC',
          drawEvent: eventData
        });
      } catch (e) {}
    }

    // 2. localStorage Event Fallback (Local 0ms สำหรับข้ามแท็บในเครื่องเดียวกัน)
    try {
      localStorage.setItem('AL_LAST_DRAW_EVENT_' + currentPin, JSON.stringify(eventData));
      localStorage.setItem('AL_LAST_DRAW_EVENT_GLOBAL', JSON.stringify(eventData));
    } catch (e) {}

    // 3. Firestore AL_Reward/_CONTROL_{PIN}_ และ _CONTROL_GLOBAL_ (Cross-device Network ข้ามเครื่องแบบ Real-time)
    if (state.db) {
      try {
        const controlDocId = '_CONTROL_' + currentPin + '_';
        const writePromises = [
          state.db.collection('AL_Reward').doc(controlDocId).set(eventData),
          state.db.collection('AL_Reward').doc('_CONTROL_GLOBAL_').set(eventData),
          state.db.collection('AL_Reward').doc('_CONTROL_LIVE_').set(eventData)
        ];
        // หากเคยตรวจพบหน้าจอเวทีใช้ PIN อื่น (เช่น AL2050) ให้ส่งไปยังห้องนั้นด้วย เพื่อให้ครอบคลุม 100%
        if (state.detectedStagePin && state.detectedStagePin !== currentPin) {
          writePromises.push(state.db.collection('AL_Reward').doc('_CONTROL_' + state.detectedStagePin + '_').set(eventData));
        }
        await Promise.allSettled(writePromises);
      } catch (err) {
        console.warn("Firestore live draw event broadcast error:", err);
      }
    }
  }

  // เปลี่ยนรหัสห้องเชื่อมต่อ (Room PIN)
  window.changeRoomPin = function(newPin) {
    const cleanPin = String(newPin || 'AL2026').trim().toUpperCase();
    if (!cleanPin) return;
    state.roomPin = cleanPin;
    try {
      localStorage.setItem('AL_ROOM_PIN', cleanPin);
    } catch (e) {}

    const input = document.getElementById('inputRoomPin');
    if (input) input.value = cleanPin;

    listenToStageHeartbeat();
    showToast(`🔑 รหัสห้องเชื่อมต่อ: ${cleanPin} (โปรดตรวจสอบว่าหน้าจอเวทีใช้รหัสเดียวกัน)`);
  };

  // ===========================================================================
  // OPERATOR ACTIONS
  // ===========================================================================

  // Select Group
  window.selectGroup = function(grp) {
    state.selectedGroup = grp;
    state.selectedExtraRewardId = null;

    // Broadcast to switch screen on all random.html devices
    broadcastLiveDrawEvent({
      type: 'GROUP_SELECT',
      group: grp
    });

    renderAllUI();
    showToast(`📺 สั่งเปลี่ยนหน้าจอ Random ไปที่: ${grp}`);
  };

  // Switch random.html to Overview mode
  window.switchStageToOverview = function() {
    state.selectedGroup = null;
    state.selectedExtraRewardId = null;

    broadcastLiveDrawEvent({
      type: 'GROUP_SELECT',
      group: 'OVERVIEW'
    });

    renderAllUI();
    showToast("🏠 สั่งทุกหน้าจอแสดงหน้ารวมกลุ่มรางวัล (Overview)");
  };

  // Select Executive in Group Extra
  window.selectExtraExecutive = function(rewardId) {
    state.selectedExtraRewardId = rewardId;

    broadcastLiveDrawEvent({
      type: 'EXTRA_SELECT',
      rewardId: rewardId
    });

    renderActiveGroupPanel();
    showToast("👤 สปอตไลต์ผู้บริหารท่านนี้บนหน้าจอใหญ่เรียบร้อยแล้ว");
  };

  // ===========================================================================
  // LIGHTBOX CONFIRMATION MODAL FOR GROUP DRAW (แทนการแสดง alert/confirm ข้อความ)
  // ===========================================================================
  window.openGroupDrawConfirmModal = function(mode = 'fast') {
    if (state.isProcessing) return;
    if (!state.selectedGroup) {
      showToast("⚠️ กรุณาเลือกกลุ่มที่จะสุ่มรางวัลก่อน");
      return;
    }

    const activeGroups = getActiveRewardGroups();
    const currentGroup = activeGroups.find(g => g.group === state.selectedGroup);
    if (!currentGroup || currentGroup.remainQty <= 0) {
      showToast("⚠️ กลุ่มนี้ทำการสุ่มรางวัลครบแล้ว");
      return;
    }

    const eligible = getEligibleCandidates();
    const groupRewards = state.rewards.filter(r => (r.group || '') === state.selectedGroup);
    groupRewards.sort(compareRewardGroups);

    let totalNeed = 0;
    const prizeQuotas = groupRewards.map((r, idx) => {
      const totalQty = parseInt(r.quantity, 10) || 1;
      const drawnCount = getDrawnCountForPrize(r);
      const need = Math.max(0, totalQty - drawnCount);
      totalNeed += need;
      return {
        reward: r,
        rewardIdx: idx,
        prizeName: r.name || `รางวัลที่ ${idx + 1}`,
        totalQty: totalQty,
        drawnCount: drawnCount,
        need: need,
        order: r.order || (idx + 1),
        imageUrl: r.imageUrl || ''
      };
    });

    if (totalNeed <= 0) {
      showToast("⚠️ ของรางวัลในกลุ่มนี้ได้รับการสุ่มครบแล้ว");
      return;
    }

    state.pendingGroupDrawMode = mode;

    const modal = document.getElementById('remoteGroupDrawConfirmModal');
    const titleText = document.getElementById('remoteGroupDrawTitleText');
    const icon = document.getElementById('remoteGroupDrawIcon');
    const content = document.getElementById('remoteGroupDrawModalContent');
    const btnConfirm = document.getElementById('btnConfirmGroupDrawAction');
    const btnIcon = document.getElementById('btnConfirmGroupDrawIcon');
    const btnText = document.getElementById('btnConfirmGroupDrawText');
    const hintBox = document.getElementById('remoteGroupDrawHintBox');
    if (!modal || !content) return;

    const isFast = mode === 'fast';
    const displayGroupName = currentGroup.groupName || currentGroup.group;
    const canDrawCount = Math.min(totalNeed, eligible.length);
    const hasEligible = eligible.length > 0;

    if (icon) icon.textContent = isFast ? '⚡' : '🎲';
    if (titleText) titleText.textContent = isFast ? 'ยืนยันการสั่งสุ่มรางวัลแบบเร็ว (Fast Draw)' : 'ยืนยันการสั่งสุ่มรางวัลปกติ (Roulette Draw)';
    if (btnIcon) btnIcon.textContent = isFast ? '⚡' : '🎲';
    if (btnText) btnText.textContent = isFast ? 'ยืนยันการสุ่มรางวัลแบบเร็ว' : 'ยืนยันการสุ่มรางวัล (รูเล็ต)';

    if (btnConfirm) {
      btnConfirm.disabled = !hasEligible;
      btnConfirm.style.opacity = hasEligible ? '1' : '0.5';
      btnConfirm.style.cursor = hasEligible ? 'pointer' : 'not-allowed';
      btnConfirm.style.background = isFast 
        ? 'linear-gradient(135deg, #f59e0b 0%, #ea580c 50%, #dc2626 100%)' 
        : 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 50%, #0284c7 100%)';
    }

    content.innerHTML = `
      <div style="margin-bottom: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.08);">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="group-badge-pill" style="font-size: 13px; padding: 4px 10px; background: rgba(245, 158, 11, 0.2); border-color: rgba(245, 158, 11, 0.4); color: #fde047;">${escapeHtml(currentGroup.group)}</span>
            <span style="font-size: 16px; font-weight: 700; color: #fff;">${escapeHtml(displayGroupName)}</span>
          </div>
          <span style="font-size: 12px; color: #94a3b8;">โหมด: <strong style="color: ${isFast ? '#fbbf24' : '#38bdf8'};">${isFast ? '⚡ สุ่มแบบเร็ว' : '🎲 สุ่มแบบรูเล็ต'}</strong></span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px; background: rgba(0,0,0,0.25); padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.06);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #94a3b8;">🎁 จำนวนรางวัลที่จะสุ่ม:</span>
            <strong style="color: #fbbf24; font-size: 16px;">${canDrawCount} รางวัล</strong>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #94a3b8;">👥 ผู้มีสิทธิ์ลุ้นรางวัลในระบบ:</span>
            <strong style="color: #38bdf8; font-size: 16px;">${eligible.length.toLocaleString()} คน</strong>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #94a3b8;">📦 รางวัลคงเหลือในกลุ่มนี้:</span>
            <span style="color: #e2e8f0; font-weight: 600;">${totalNeed} / ${currentGroup.totalQty} รางวัล</span>
          </div>
        </div>

        <div style="margin-top: 12px; max-height: 140px; overflow-y: auto; padding: 8px 12px; background: rgba(0,0,0,0.18); border-radius: 8px; font-size: 12px; border: 1px solid rgba(255,255,255,0.04);">
          <div style="color: #94a3b8; font-weight: 600; margin-bottom: 6px;">📋 รายการของรางวัลที่จะทำการสุ่ม:</div>
          ${prizeQuotas.filter(p => p.need > 0).map(p => `
            <div style="display: flex; justify-content: space-between; padding: 3px 0; color: #e2e8f0; border-bottom: 1px dashed rgba(255,255,255,0.04);">
              <span>• ${escapeHtml(p.prizeName)}</span>
              <span style="color: #fde047; font-weight: 600;">(สุ่ม ${p.need} รางวัล)</span>
            </div>
          `).join('')}
        </div>

        ${!hasEligible ? `
          <div style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; padding: 10px 12px; border-radius: 8px; margin-top: 12px; font-size: 12px; line-height: 1.5;">
            ⚠️ ไม่มีผู้มีสิทธิ์ลุ้นรางวัลที่ยังไม่ได้รับรางวัลในระบบ (เงื่อนไข: ฟิลด์ Member และ EmpName ไม่ว่าง และยังไม่เคยได้รับรางวัล)
          </div>
        ` : ''}

        ${(hasEligible && eligible.length < totalNeed) ? `
          <div style="background: rgba(245, 158, 11, 0.2); border: 1px solid rgba(245, 158, 11, 0.4); color: #fde047; padding: 8px 12px; border-radius: 8px; margin-top: 10px; font-size: 12px;">
            ⚠️ มีผู้มีสิทธิ์ ${eligible.length} คน ซึ่งน้อยกว่าจำนวนรางวัลคงเหลือ ${totalNeed} รางวัล (ระบบจะทำการสุ่มได้เท่ากับจำนวนคน)
          </div>
        ` : ''}
      </div>
    `;

    if (hintBox) {
      hintBox.textContent = isFast
        ? '* เมื่อกดยืนยัน ระบบจะทำการสุ่มทุกรางวัลที่เหลือพร้อมกัน และสั่งให้ทุกหน้าจอแสดงอนิเมชั่นสับเปลี่ยนรายชื่อพร้อมจุดพลุ'
        : '* เมื่อกดยืนยัน ระบบจะสั่งให้ทุกหน้าจอดำเนินการหมุนรูเล็ตสุ่มทีละรางวัลพร้อมจอแสดงผู้โชคดี';
    }

    modal.style.display = 'flex';
  };

  window.closeGroupDrawConfirmModal = function() {
    const modal = document.getElementById('remoteGroupDrawConfirmModal');
    if (modal) modal.style.display = 'none';
    state.pendingGroupDrawMode = null;
  };

  window.confirmExecuteGroupDraw = async function() {
    const mode = state.pendingGroupDrawMode || 'fast';
    window.closeGroupDrawConfirmModal();

    if (mode === 'fast') {
      await executeActualFastDraw();
    } else {
      await executeActualRouletteDraw();
    }
  };

  // Fast Draw trigger from remote
  window.executeRemoteFastDraw = function() {
    window.openGroupDrawConfirmModal('fast');
  };

  async function executeActualFastDraw() {
    if (state.isProcessing) return;
    if (!state.selectedGroup) {
      showToast("⚠️ กรุณาเลือกกลุ่มที่จะสุ่มรางวัลก่อน");
      return;
    }

    const activeGroups = getActiveRewardGroups();
    const currentGroup = activeGroups.find(g => g.group === state.selectedGroup);
    if (!currentGroup || currentGroup.remainQty <= 0) {
      showToast("⚠️ กลุ่มนี้ทำการสุ่มรางวัลครบแล้ว");
      return;
    }

    const eligible = getEligibleCandidates();
    if (eligible.length === 0) {
      showToast("⚠️ ไม่มีผู้มีสิทธิ์ลุ้นรางวัลที่ยังไม่ได้รับรางวัลในระบบ");
      return;
    }

    // Prepare quotas
    const groupRewards = state.rewards.filter(r => (r.group || '') === state.selectedGroup);
    groupRewards.sort(compareRewardGroups);

    let totalNeed = 0;
    const prizeQuotas = groupRewards.map((r, idx) => {
      const totalQty = parseInt(r.quantity, 10) || 1;
      const drawnCount = getDrawnCountForPrize(r);
      const need = Math.max(0, totalQty - drawnCount);
      totalNeed += need;
      return {
        reward: r,
        rewardIdx: idx,
        prizeName: r.name || `รางวัลที่ ${idx + 1}`,
        totalQty: totalQty,
        drawnCount: drawnCount,
        need: need,
        order: r.order || (idx + 1),
        imageUrl: r.imageUrl || ''
      };
    });

    if (totalNeed <= 0) {
      showToast("⚠️ ของรางวัลในกลุ่มนี้ได้รับการสุ่มครบแล้ว");
      return;
    }

    state.isProcessing = true;
    updateActionButtonsState();

    try {
      // สั่งให้หน้าจอ random.html (เวที) เป็นผู้กดปุ่มเพื่อทำการสุ่มที่ฝั่ง random.html
      await broadcastLiveDrawEvent({
        type: 'REMOTE_TRIGGER_FAST_DRAW',
        group: state.selectedGroup
      });
      showToast(`⚡ ส่งคำสั่งไปยังหน้าจอ Random ให้เริ่มทำการสุ่มแบบเร็ว (${currentGroup.group}) แล้ว!`);
    } catch (err) {
      console.warn("Trigger fast draw error:", err);
      showToast("⚠️ ไม่สามารถส่งคำสั่งได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setTimeout(() => {
        state.isProcessing = false;
        updateActionButtonsState();
      }, 2500);
    }
  }

  // Roulette Draw trigger from remote
  window.executeRemoteRouletteDraw = function() {
    window.openGroupDrawConfirmModal('roulette');
  };

  async function executeActualRouletteDraw() {
    if (state.isProcessing) return;
    if (!state.selectedGroup) {
      showToast("⚠️ กรุณาเลือกกลุ่มที่จะสุ่มรางวัลก่อน");
      return;
    }

    const activeGroups = getActiveRewardGroups();
    const currentGroup = activeGroups.find(g => g.group === state.selectedGroup);
    if (!currentGroup || currentGroup.remainQty <= 0) {
      showToast("⚠️ กลุ่มนี้ทำการสุ่มรางวัลครบแล้ว");
      return;
    }

    const eligible = getEligibleCandidates();
    if (eligible.length === 0) {
      showToast("⚠️ ไม่มีผู้มีสิทธิ์ลุ้นรางวัลที่ยังไม่ได้รับรางวัลในระบบ");
      return;
    }

    state.isProcessing = true;
    updateActionButtonsState();

    try {
      // สั่งให้หน้าจอ random.html (เวที) เป็นผู้กดปุ่มเพื่อทำการสุ่มที่ฝั่ง random.html
      await broadcastLiveDrawEvent({
        type: 'REMOTE_TRIGGER_ROULETTE_DRAW',
        group: state.selectedGroup
      });
      showToast(`🎲 ส่งคำสั่งไปยังหน้าจอ Random ให้เริ่มหมุนรูเล็ตสุ่มรางวัล (${currentGroup.group}) แล้ว!`);
    } catch (err) {
      console.warn("Trigger roulette draw error:", err);
      showToast("⚠️ ไม่สามารถส่งคำสั่งได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setTimeout(() => {
        state.isProcessing = false;
        updateActionButtonsState();
      }, 2500);
    }
  }

  // ===========================================================================
  // LIGHTBOX CONFIRMATION MODAL FOR EXTRA DRAW (แทนการแสดง alert/confirm ข้อความ)
  // ===========================================================================
  window.openExtraDrawConfirmModal = function(rewardId) {
    if (state.isProcessing) return;
    const extraRewards = state.rewards.filter(r => (r.group || '') === 'Group Extra');
    extraRewards.sort(compareRewardGroups);

    let reward = extraRewards.find(r => r.id === rewardId);
    if (!reward) {
      const idx = parseInt(String(rewardId).replace('idx_', ''), 10);
      if (!isNaN(idx) && extraRewards[idx]) {
        reward = extraRewards[idx];
      }
    }
    if (!reward) {
      showToast("⚠️ ไม่พบข้อมูลรางวัลพิเศษนี้");
      return;
    }

    const drawnCount = getDrawnCountForPrize(reward);
    const qty = parseInt(reward.quantity, 10) || 1;
    if (drawnCount >= qty) {
      showToast(`⚠️ รางวัลของผู้บริหารท่านนี้ได้รับการสุ่มครบแล้ว (${drawnCount}/${qty})`);
      return;
    }

    const remainingNeed = Math.max(0, qty - drawnCount);
    const eligible = getEligibleCandidates();
    state.pendingExtraDrawRewardId = reward.id || ('idx_' + extraRewards.indexOf(reward));

    const modal = document.getElementById('remoteExtraDrawConfirmModal');
    const content = document.getElementById('remoteExtraDrawModalContent');
    const btnConfirm = document.getElementById('btnConfirmExtraDrawAction');
    const btnText = document.getElementById('btnConfirmExtraDrawText');
    const hintBox = document.getElementById('remoteExtraDrawHintBox');
    if (!modal || !content) return;

    const execName = reward.owner || 'ผู้บริหาร';
    const execPosition = reward.ownerPosition || 'ผู้บริหารระดับสูง';
    const cleanName = (reward.name || 'รางวัลพิเศษ').trim();
    const avatarSrc = reward.ownerImage || './images/person.png';
    const hasEligible = eligible.length > 0;

    content.innerHTML = `
      <div style="display: flex; gap: 14px; align-items: center; margin-bottom: 14px;">
        <div style="width: 58px; height: 58px; border-radius: 50%; border: 2px solid #f59e0b; overflow: hidden; background: #0f172a; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
          <img src="${escapeHtml(avatarSrc)}" alt="Avatar" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='./images/person.png'">
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 11px; color: #fde047; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">ผู้บริหารผู้มอบรางวัล</div>
          <div style="font-size: 16px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(execName)}</div>
          <div style="font-size: 12px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(execPosition)}</div>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px; background: rgba(0,0,0,0.25); padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.06);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: #94a3b8;">🎁 ของรางวัล:</span>
          <strong style="color: #fde047; font-size: 14px;">${escapeHtml(cleanName)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: #94a3b8;">🔢 จำนวนที่จะสุ่มครั้งนี้:</span>
          <strong style="color: #fbbf24; font-size: 14px;">
            ${qty > 1 
              ? (drawnCount > 0 ? `สุ่มที่เหลือ ${remainingNeed} รางวัล (ครบตามจำนวนที่เหลือ)` : `สุ่มทั้งหมด ${qty} รางวัล`) 
              : `1 รางวัล (ครบตามจำนวน)`}
          </strong>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: #94a3b8;">👥 ผู้มีสิทธิ์ลุ้นรางวัลในระบบ:</span>
          <strong style="color: #38bdf8; font-size: 14px;">${eligible.length.toLocaleString()} คน</strong>
        </div>
      </div>
      ${!hasEligible ? `
        <div style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; padding: 10px 12px; border-radius: 8px; margin-top: 12px; font-size: 12px; line-height: 1.5;">
          ⚠️ ไม่มีผู้มีสิทธิ์ลุ้นรางวัลที่ยังไม่ได้รับรางวัลในระบบ (เงื่อนไข: ฟิลด์ Member และ EmpName ไม่ว่าง และยังไม่เคยได้รับรางวัล)
        </div>
      ` : ''}
    `;

    if (btnText) {
      btnText.textContent = qty > 1 
        ? (drawnCount > 0 ? `🎯 ยืนยันสั่งสุ่มที่เหลือ ${remainingNeed} รางวัล` : `🎯 ยืนยันสั่งสุ่มทั้งหมด ${qty} รางวัล`) 
        : `🎯 ยืนยันการสุ่มรางวัล`;
    }

    if (btnConfirm) {
      btnConfirm.disabled = !hasEligible;
      btnConfirm.style.opacity = hasEligible ? '1' : '0.5';
      btnConfirm.style.cursor = hasEligible ? 'pointer' : 'not-allowed';
    }

    if (hintBox) {
      hintBox.style.display = hasEligible ? 'block' : 'none';
    }

    modal.style.display = 'flex';
  };

  window.closeExtraDrawConfirmModal = function() {
    const modal = document.getElementById('remoteExtraDrawConfirmModal');
    if (modal) modal.style.display = 'none';
    state.pendingExtraDrawRewardId = null;
  };

  window.confirmExecuteExtraDraw = async function() {
    if (!state.pendingExtraDrawRewardId) return;
    const rewardId = state.pendingExtraDrawRewardId;
    window.closeExtraDrawConfirmModal();

    await executeActualExtraDraw(rewardId);
  };

  // Group Extra Draw execution from remote
  window.executeRemoteExtraDraw = function(rewardId) {
    window.openExtraDrawConfirmModal(rewardId);
  };

  async function executeActualExtraDraw(rewardId) {
    if (state.isProcessing) return;
    const extraRewards = state.rewards.filter(r => (r.group || '') === 'Group Extra');
    extraRewards.sort(compareRewardGroups);

    let reward = extraRewards.find(r => r.id === rewardId);
    if (!reward) {
      const idx = parseInt(String(rewardId).replace('idx_', ''), 10);
      if (!isNaN(idx) && extraRewards[idx]) {
        reward = extraRewards[idx];
      }
    }
    if (!reward) {
      showToast("⚠️ ไม่พบข้อมูลรางวัลพิเศษ");
      return;
    }

    const drawnCount = getDrawnCountForPrize(reward);
    const qty = parseInt(reward.quantity, 10) || 1;
    const remainingNeed = qty - drawnCount;
    if (remainingNeed <= 0) {
      showToast(`⚠️ รางวัลของผู้บริหารท่านนี้ได้รับการสุ่มครบแล้ว (${drawnCount}/${qty})`);
      return;
    }

    const eligible = getEligibleCandidates();
    if (eligible.length === 0) {
      showToast("⚠️ ไม่มีผู้มีสิทธิ์ลุ้นรางวัลที่ยังไม่ได้รับรางวัลในระบบ");
      return;
    }

    const selectedIndex = extraRewards.indexOf(reward);
    const execName = reward.owner || 'ผู้บริหาร';
    const targetRewardId = reward.id || ('idx_' + selectedIndex);

    state.isProcessing = true;
    updateActionButtonsState();

    try {
      // สั่งให้หน้าจอ random.html (เวที) เป็นผู้กดปุ่มสุ่มรายการที่ฝั่ง random.html
      // เพื่อให้ฝั่ง random.html แสดงผล action การสุ่ม รูเล็ต จุดพลุ และเสียงเต็มรูปแบบ
      await broadcastLiveDrawEvent({
        type: 'REMOTE_TRIGGER_EXTRA_DRAW',
        group: 'Group Extra',
        rewardId: targetRewardId,
        selectedIndex: selectedIndex
      });
      showToast(`🎯 ส่งคำสั่งไปยังหน้าจอ Random ให้เริ่มทำการสุ่มรางวัลของ ${execName} แล้ว!`);
    } catch (err) {
      console.warn("Trigger extra draw error:", err);
      showToast("⚠️ ไม่สามารถส่งคำสั่งได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setTimeout(() => {
        state.isProcessing = false;
        updateActionButtonsState();
      }, 2500);
    }
  }

  // Group Extra Redraw Confirmation Modal
  window.openExtraRedrawModal = function(rewardId) {
    const extraRewards = state.rewards.filter(r => (r.group || '') === 'Group Extra');
    let reward = extraRewards.find(r => r.id === rewardId);
    if (!reward) {
      const idx = parseInt(String(rewardId).replace('idx_', ''), 10);
      if (!isNaN(idx) && extraRewards[idx]) {
        reward = extraRewards[idx];
      }
    }
    if (!reward) return;

    // Find winners
    const rId = String(reward.id || '').trim();
    const rOwner = String(reward.owner || '').trim().replace(/^คุณ\s*/, '').toLowerCase();
    const rName = String(reward.name || '').trim().toLowerCase();

    const winners = state.employees.filter(e => {
      if (!e || !e.RewardName) return false;
      const eName = String(e.RewardName).trim().toLowerCase();
      if (eName !== rName) return false;
      if (rId && e.RewardId && String(e.RewardId).trim() === rId) return true;
      const eOwner = String(e.RewardOwner || e.RewardExecutive || '').trim().replace(/^คุณ\s*/, '').toLowerCase();
      if (rOwner && eOwner && eOwner === rOwner) return true;
      if (!rOwner && !eOwner) return true;
      return false;
    });

    if (winners.length === 0) {
      showToast("⚠️ ยังไม่มีผู้ได้รับรางวัลสำหรับผู้บริหารท่านนี้");
      return;
    }

    const winner = winners[winners.length - 1];
    state.pendingRedrawRewardId = reward.id || ('idx_' + extraRewards.indexOf(reward));

    const modal = document.getElementById('remoteRedrawModal');
    const content = document.getElementById('remoteRedrawModalContent');
    if (!modal || !content) return;

    content.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div><strong>🎁 รางวัล:</strong> ${escapeHtml(reward.name || 'รางวัลพิเศษ')}</div>
        <div><strong>👤 ผู้บริหารที่มอบรางวัล:</strong> ${escapeHtml(reward.owner || '-')} (${escapeHtml(reward.ownerPosition || '-')})</div>
        <hr style="border: none; border-top: 1px dashed rgba(255,255,255,0.15); margin: 4px 0;">
        <div><strong>🏷️ รหัสพนักงานที่ได้รางวัล:</strong> <span style="color: #38bdf8; font-weight: 700;">${escapeHtml(winner.EmployeeID || '-')}</span></div>
        <div><strong>🏆 ชื่อผู้โชคดี:</strong> <span style="color: #fbbf24; font-weight: 700;">${escapeHtml(winner.EmpName || '-')}</span></div>
        <div><strong>🏢 สังกัด:</strong> ${escapeHtml(winner.Group || '-')}</div>
        <div><strong>⏱️ เวลาที่สุ่มได้:</strong> ${escapeHtml(winner.RewardDrawTime || winner.RewardTime || '-')}</div>
      </div>
    `;

    modal.style.display = 'flex';
  };

  window.closeExtraRedrawModal = function() {
    const modal = document.getElementById('remoteRedrawModal');
    if (modal) modal.style.display = 'none';
    state.pendingRedrawRewardId = null;
  };

  window.confirmExecuteExtraRedraw = async function() {
    if (!state.pendingRedrawRewardId) return;
    const rewardId = state.pendingRedrawRewardId;
    window.closeExtraRedrawModal();

    const extraRewards = state.rewards.filter(r => (r.group || '') === 'Group Extra');
    let reward = extraRewards.find(r => r.id === rewardId);
    if (!reward) {
      const idx = parseInt(String(rewardId).replace('idx_', ''), 10);
      if (!isNaN(idx) && extraRewards[idx]) {
        reward = extraRewards[idx];
      }
    }
    if (!reward) return;

    const rId = String(reward.id || '').trim();
    const rOwner = String(reward.owner || '').trim().replace(/^คุณ\s*/, '').toLowerCase();
    const rName = String(reward.name || '').trim().toLowerCase();

    const winners = state.employees.filter(e => {
      if (!e || !e.RewardName) return false;
      const eName = String(e.RewardName).trim().toLowerCase();
      if (eName !== rName) return false;
      if (rId && e.RewardId && String(e.RewardId).trim() === rId) return true;
      const eOwner = String(e.RewardOwner || e.RewardExecutive || '').trim().replace(/^คุณ\s*/, '').toLowerCase();
      if (rOwner && eOwner && eOwner === rOwner) return true;
      if (!rOwner && !eOwner) return true;
      return false;
    });

    if (winners.length === 0) return;

    state.isProcessing = true;
    updateActionButtonsState();

    const clearedWinnerIds = winners.map(w => w.EmployeeID);

    // Broadcast reset event to all random screens
    await broadcastLiveDrawEvent({
      type: 'REMOTE_TRIGGER_EXTRA_REDRAW',
      group: 'Group Extra',
      rewardId: rewardId,
      clearedWinnerIds: clearedWinnerIds
    });
    await broadcastLiveDrawEvent({
      type: 'EXTRA_RESET',
      group: 'Group Extra',
      rewardId: rewardId,
      clearedWinnerIds: clearedWinnerIds
    });

    // Reset in Firestore
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
          await state.db.collection(state.employeesCollection).doc(docId).set({
            RewardName: '',
            RewardOwner: '',
            RewardExecutive: '',
            RewardId: '',
            RewardGroup: '',
            RewardDrawTime: null,
            RewardTime: null,
            RewardStatus: 'ยังไม่ได้รับรางวัล'
          }, { merge: true });
        } catch (err) {
          console.warn("Firestore reset extra winner error:", err);
        }
      }
    }

    state.isProcessing = false;
    updateActionButtonsState();
    renderAllUI();
    showToast("🗑️ ลบรายชื่อผู้ได้รับการสุ่มเรียบร้อยแล้ว ทุกหน้าจอพร้อมสุ่มใหม่");
  };

  function updateActionButtonsState() {
    const btns = document.querySelectorAll('.btn-remote-draw-cmd, .btn-exec-draw, .btn-exec-redraw');
    btns.forEach(b => {
      b.disabled = state.isProcessing;
    });
  }

  // ===========================================================================
  // UI RENDERING
  // ===========================================================================

  function renderAllUI() {
    renderHeaderStats();
    renderGroupsSelectorGrid();
    renderActiveGroupPanel();
  }

  function renderHeaderStats() {
    const eligibleCount = getEligibleCandidates().length;
    const elEligible = document.getElementById('remoteEligibleCount');
    if (elEligible) {
      elEligible.textContent = `${eligibleCount.toLocaleString()} คน`;
    }

    const activeGroups = getActiveRewardGroups();
    const totalRemain = activeGroups.reduce((acc, g) => acc + (Number(g.remainQty) || 0), 0);
    const elPrizesRemain = document.getElementById('remotePrizesRemain');
    if (elPrizesRemain) {
      elPrizesRemain.textContent = `${totalRemain.toLocaleString()} รางวัล`;
    }
  }

  function renderGroupsSelectorGrid() {
    const grid = document.getElementById('groupsSelectorGrid');
    if (!grid) return;

    const activeGroups = getActiveRewardGroups();
    if (activeGroups.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 30px; color: var(--text-muted);">
          ยังไม่มีรายการของรางวัลในฐานข้อมูล กรุณาเพิ่มรางวัลที่หน้า Admin
        </div>
      `;
      return;
    }

    // Default to first group if none selected
    if (!state.selectedGroup) {
      state.selectedGroup = activeGroups[0].group;
    }

    let html = '';
    activeGroups.forEach(item => {
      const isSelected = item.group === state.selectedGroup;
      const isComplete = item.isComplete;
      const displayTitle = item.groupName || item.group;
      const grpClass = item.group.replace(/\s+/g, '-');

      html += `
        <div class="group-controller-card badge-group-${escapeHtml(grpClass)} ${isSelected ? 'active' : ''} ${isComplete ? 'is-complete' : ''}"
             onclick="window.selectGroup('${escapeHtml(item.group)}')"
             title="คลิกเพื่อเลือกกลุ่ม ${escapeHtml(displayTitle)}">
          
          <div class="group-card-header">
            <span class="group-badge-pill group-badge-${escapeHtml(grpClass)}">${escapeHtml(item.group)}</span>
            <span class="group-status-tag ${isComplete ? 'complete' : 'ready'}">
              ${isComplete ? '✓ สุ่มครบแล้ว' : `คงเหลือ ${item.remainQty}`}
            </span>
          </div>

          <h3 class="group-card-title">${escapeHtml(displayTitle)}</h3>

          <div class="group-stats-row">
            <div class="stat-item">
              <span class="stat-label">ของรางวัล</span>
              <span class="stat-val">${item.totalQty}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">สุ่มแล้ว</span>
              <span class="stat-val text-green">${item.drawnQty}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">คงเหลือ</span>
              <span class="stat-val text-yellow">${item.remainQty}</span>
            </div>
          </div>

          <button type="button" class="group-card-btn-action">
            <span>${isSelected ? '🎯 กำลังเลือกกลุ่มนี้' : 'เลือกกลุ่มนี้'}</span>
          </button>
        </div>
      `;
    });

    grid.innerHTML = html;
  }

  function renderActiveGroupPanel() {
    const wrap = document.getElementById('activeGroupPanelWrap');
    if (!wrap) return;

    if (!state.selectedGroup) {
      wrap.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          กรุณาคลิกเลือกกลุ่มรางวัลจากแผงด้านบนเพื่อควบคุมการสุ่ม
        </div>
      `;
      return;
    }

    const activeGroups = getActiveRewardGroups();
    const currentGroup = activeGroups.find(g => g.group === state.selectedGroup);
    if (!currentGroup) {
      wrap.innerHTML = `<div style="text-align: center; padding: 20px;">ไม่พบข้อมูลกลุ่ม</div>`;
      return;
    }

    const displayTitle = currentGroup.groupName || currentGroup.group;
    const isGroupExtra = state.selectedGroup === 'Group Extra';

    // Hero Bar
    let html = `
      <div class="active-group-hero">
        <div class="hero-left">
          <span class="hero-group-pill">${escapeHtml(currentGroup.group)}</span>
          <div>
            <div class="hero-title">${escapeHtml(displayTitle)}</div>
            <div class="hero-sub">ทุกหน้าจอ Random กำลังแสดงผลกลุ่มนี้อยู่</div>
          </div>
        </div>
        <div class="hero-right">
          <div class="hero-stat-badge">
            คงเหลือ: <strong>${currentGroup.remainQty} / ${currentGroup.totalQty}</strong> รางวัล
          </div>
        </div>
      </div>
    `;

    if (isGroupExtra) {
      // GROUP EXTRA CONTROLS (Executives List & Draw)
      html += renderGroupExtraControls(currentGroup);
    } else {
      // REGULAR GROUP CONTROLS (Fast Draw & Roulette Buttons + Prizes list)
      html += renderNormalGroupControls(currentGroup);
    }

    wrap.innerHTML = html;
  }

  function renderNormalGroupControls(groupItem) {
    const isComplete = groupItem.isComplete;
    const groupRewards = state.rewards.filter(r => (r.group || '') === state.selectedGroup);
    groupRewards.sort(compareRewardGroups);

    let html = `
      <!-- Big Action Buttons -->
      <div class="draw-action-buttons-bar">
        <button type="button" class="btn-remote-draw-cmd btn-cmd-fast" 
                onclick="window.executeRemoteFastDraw()" 
                ${isComplete ? 'disabled' : ''}
                title="${isComplete ? 'สุ่มครบแล้ว' : 'กดเพื่อสั่งสุ่มของรางวัลที่เหลือทั้งหมดพร้อมกัน'}">
          <span class="btn-main-label">⚡ สุ่มรางวัลแบบเร็ว (Fast Draw)</span>
          <span class="btn-sub-label">สุ่มทุกกล่องที่เหลือพร้อมกันในคราวเดียว พร้อมอนิเมชั่นและจุดพลุ</span>
        </button>

        <button type="button" class="btn-remote-draw-cmd btn-cmd-roulette" 
                onclick="window.executeRemoteRouletteDraw()" 
                ${isComplete ? 'disabled' : ''}
                title="${isComplete ? 'สุ่มครบแล้ว' : 'กดเพื่อสั่งสุ่มแบบหมุนรูเล็ตทีละรางวัล'}">
          <span class="btn-main-label">🎲 สุ่มรางวัลปกติ (Roulette Draw)</span>
          <span class="btn-sub-label">หมุนรูเล็ตสุ่มทีละรางวัล พร้อมจอแสดงผู้โชคดี</span>
        </button>
      </div>

      <!-- Prizes In Group List -->
      <h4 style="font-size: 15px; font-weight: 600; margin-bottom: 12px; color: #cbd5e1;">
        📦 รายการของรางวัลในกลุ่มนี้ (${groupRewards.length} รายการ):
      </h4>
      <div class="remote-prizes-list">
    `;

    groupRewards.forEach((r, idx) => {
      const totalQty = parseInt(r.quantity, 10) || 1;
      const drawnCount = getDrawnCountForPrize(r);
      const remainCount = Math.max(0, totalQty - drawnCount);
      const isPrizeDone = remainCount <= 0;

      // Find winners for this prize
      const rId = String(r.id || '').trim();
      const rOwner = String(r.owner || '').trim().replace(/^คุณ\s*/, '').toLowerCase();
      const rName = String(r.name || '').trim().toLowerCase();

      const winners = state.employees.filter(e => {
        if (!e || !e.RewardName) return false;
        const eName = String(e.RewardName).trim().toLowerCase();
        if (eName !== rName) return false;
        if (rId && e.RewardId && String(e.RewardId).trim() === rId) return true;
        const eOwner = String(e.RewardOwner || e.RewardExecutive || '').trim().replace(/^คุณ\s*/, '').toLowerCase();
        if (rOwner && eOwner && eOwner === rOwner) return true;
        if (!rOwner && !eOwner) return true;
        return false;
      });

      html += `
        <div class="remote-prize-item-card">
          <div class="prize-item-top">
            <div class="prize-item-info">
              <span class="prize-order-tag">ลำดับที่ ${idx + 1}</span>
              <strong class="prize-item-name">${escapeHtml(r.name || '-')}</strong>
            </div>
            <div class="prize-item-quotas">
              <span>จำนวน ${totalQty} รางวัล</span>
              <span>•</span>
              <span style="color: ${isPrizeDone ? '#34d399' : '#fbbf24'}; font-weight: 600;">
                ${isPrizeDone ? `✓ สุ่มครบแล้ว (${drawnCount}/${totalQty})` : `คงเหลือ ${remainCount}`}
              </span>
            </div>
          </div>

          ${winners.length > 0 ? `
            <div class="prize-winners-tags">
              <span style="font-size: 12px; color: var(--text-muted); align-self: center;">ผู้โชคดี:</span>
              ${winners.map(w => `
                <span class="winner-tag">
                  🏆 ${escapeHtml(w.EmployeeID || '')} ${escapeHtml(w.EmpName || '')} (${escapeHtml(w.Group || '-')})
                </span>
              `).join('')}
            </div>
          ` : `
            <div style="font-size: 12px; color: var(--text-muted); padding-top: 4px;">
              ⏳ รอทำการสุ่มเลือกผู้รับรางวัล
            </div>
          `}
        </div>
      `;
    });

    html += `</div>`;
    return html;
  }

  function renderGroupExtraControls(groupItem) {
    const extraRewards = state.rewards.filter(r => (r.group || '') === 'Group Extra');
    extraRewards.sort(compareRewardGroups);

    if (extraRewards.length === 0) {
      return `<div style="padding: 20px; text-align: center; color: var(--text-muted);">ไม่มีรายการใน Group Extra</div>`;
    }

    if (!state.selectedExtraRewardId && extraRewards.length > 0) {
      state.selectedExtraRewardId = extraRewards[0].id || 'idx_0';
    }

    let html = `
      <div style="margin-bottom: 14px; font-size: 14px; color: #cbd5e1;">
        👑 รายการผู้บริหารใน Group Extra (คลิกที่ผู้บริหารเพื่อเลือกและสั่งสุ่ม):
      </div>
      <div class="group-extra-exec-grid">
    `;

    let selectedRewardObj = null;

    extraRewards.forEach((r, idx) => {
      const rewardId = r.id || ('idx_' + idx);
      const isSelected = rewardId === state.selectedExtraRewardId;
      if (isSelected) selectedRewardObj = r;

      const qty = parseInt(r.quantity, 10) || 1;
      const drawnCount = getDrawnCountForPrize(r);
      const isDone = drawnCount >= qty;
      const remain = Math.max(0, qty - drawnCount);
      const avatarSrc = r.ownerImage || './images/person.png';

      // Find winner details if won
      const rId = String(r.id || '').trim();
      const rOwner = String(r.owner || '').trim().replace(/^คุณ\s*/, '').toLowerCase();
      const rName = String(r.name || '').trim().toLowerCase();

      const winners = state.employees.filter(e => {
        if (!e || !e.RewardName) return false;
        const eName = String(e.RewardName).trim().toLowerCase();
        if (eName !== rName) return false;
        if (rId && e.RewardId && String(e.RewardId).trim() === rId) return true;
        const eOwner = String(e.RewardOwner || e.RewardExecutive || '').trim().replace(/^คุณ\s*/, '').toLowerCase();
        if (rOwner && eOwner && eOwner === rOwner) return true;
        if (!rOwner && !eOwner) return true;
        return false;
      });

      let badgeHtml = '';
      if (isDone) {
        badgeHtml = `<span class="exec-status-badge won">✓ สุ่มครบแล้ว (${qty}/${qty})</span>`;
      } else if (drawnCount > 0) {
        badgeHtml = `<span class="exec-status-badge in-progress" style="background: rgba(245, 158, 11, 0.2); color: #fde047; border: 1px solid rgba(245, 158, 11, 0.4);">🎯 สุ่มแล้ว ${drawnCount}/${qty} (เหลือ ${remain})</span>`;
      } else {
        badgeHtml = `<span class="exec-status-badge pending">🎯 ยังไม่สุ่ม (เหลือ ${qty})</span>`;
      }

      html += `
        <div class="exec-controller-card ${isSelected ? 'active' : ''}" 
             onclick="window.selectExtraExecutive('${escapeHtml(rewardId)}')">
          <div class="exec-avatar-frame">
            <img src="${escapeHtml(avatarSrc)}" alt="Avatar" class="exec-avatar-img" onerror="this.src='./images/person.png'">
          </div>
          <div class="exec-info-col">
            <div class="exec-name-text">${escapeHtml(r.owner || 'ผู้บริหาร')}</div>
            <div class="exec-position-text">${escapeHtml(r.ownerPosition || 'ผู้บริหารระดับสูง')}</div>
            <div>
              ${badgeHtml}
            </div>
            ${winners.length > 0 ? `
              <div style="font-size: 11px; color: #34d399; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${winners.map(w => escapeHtml((w.EmployeeID || '') + ' ' + (w.EmpName || ''))).join(', ')}">
                ผู้ได้รับ: ${winners.map(w => escapeHtml((w.EmployeeID || '') + ' ' + (w.EmpName || ''))).join(', ')}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    });

    html += `</div>`;

    // Action Panel for Selected Executive
    if (selectedRewardObj) {
      const rewardId = selectedRewardObj.id || ('idx_' + extraRewards.indexOf(selectedRewardObj));
      const totalQty = parseInt(selectedRewardObj.quantity, 10) || 1;
      const drawnCount = getDrawnCountForPrize(selectedRewardObj);
      const isDone = drawnCount >= totalQty;
      const execName = selectedRewardObj.owner || 'ผู้บริหาร';

      html += `
        <div class="exec-draw-action-panel">
          <div class="exec-draw-info">
            <span style="font-size: 24px;">👑</span>
            <div>
              <div class="exec-selected-label">ผู้บริหารที่เลือกอยู่:</div>
              <div class="exec-selected-name">${escapeHtml(execName)} (${escapeHtml(selectedRewardObj.ownerPosition || '-')})</div>
              <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">
                ของรางวัล: <strong style="color: #fde047;">${escapeHtml(selectedRewardObj.name || 'ของรางวัล')}</strong> 
                (สุ่มแล้ว ${drawnCount}/${totalQty} รางวัล)
              </div>
            </div>
          </div>
          <div class="exec-actions-btn-group">
            ${!isDone ? `
              <button type="button" class="btn-exec-draw" onclick="window.openExtraDrawConfirmModal('${escapeHtml(rewardId)}')">
                <span>🎯</span>
                <span>
                  ${totalQty > 1 
                    ? (drawnCount > 0 ? `สั่งสุ่มรางวัลที่เหลือ (${totalQty - drawnCount} รางวัล)` : `สั่งสุ่มของรางวัลทั้งหมด (${totalQty} รางวัล)`) 
                    : `สั่งสุ่มรางวัลพิเศษ`}
                </span>
              </button>
            ` : ''}
            ${drawnCount > 0 ? `
              <button type="button" class="btn-exec-redraw" onclick="window.openExtraRedrawModal('${escapeHtml(rewardId)}')">
                <span>🔄</span>
                <span>สุ่มใหม่ (ลบผลเดิมและสุ่มใหม่)</span>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }

    return html;
  }

  // ===========================================================================
  // STAGE SCREEN HEARTBEAT LISTENER (ตรวจสอบสถานะหน้าจอ random.html ข้ามเครื่อง)
  // ===========================================================================
  function listenToStageHeartbeat() {
    if (!state.db) return;
    if (state.unsubscribeStageHeartbeat) {
      state.unsubscribeStageHeartbeat();
    }
    if (state.unsubscribeGlobalStageHeartbeat) {
      state.unsubscribeGlobalStageHeartbeat();
    }
    const currentPin = String(state.roomPin || 'AL2026').trim().toUpperCase();
    const stageDocId = '_STAGE_ONLINE_' + currentPin + '_';

    const updateStageIndicator = (data, fallbackPin) => {
      const statusPill = document.getElementById('remoteStageStatus');
      if (!statusPill) return false;

      const isAlive = data && ((Date.now() - (data.lastActiveTime || 0)) < 16000);
      if (isAlive) {
        const livePin = String(data.roomPin || fallbackPin || currentPin).trim().toUpperCase();
        state.detectedStagePin = livePin;
        statusPill.className = 'status-pill';
        statusPill.style.background = 'rgba(16, 185, 129, 0.18)';
        statusPill.style.borderColor = 'rgba(16, 185, 129, 0.5)';
        statusPill.style.color = '#34d399';
        const syncNote = (livePin === currentPin) 
          ? `(ห้อง ${currentPin} พร้อมสั่งงาน)` 
          : `(เวทีห้อง ${livePin} - เชื่อมต่ออัตโนมัติ)`;
        statusPill.innerHTML = `<span class="status-dot"></span><span>🖥️ หน้าจอเวทีออนไลน์ ${syncNote}</span>`;
        return true;
      }
      return false;
    };

    state.unsubscribeStageHeartbeat = state.db.collection('AL_Reward').doc(stageDocId)
      .onSnapshot((doc) => {
        const ok = doc && doc.exists && updateStageIndicator(doc.data(), currentPin);
        if (!ok && !state.hasGlobalStageOnline) {
          const statusPill = document.getElementById('remoteStageStatus');
          if (statusPill) {
            statusPill.className = 'status-pill offline';
            statusPill.style.background = 'rgba(245, 158, 11, 0.18)';
            statusPill.style.borderColor = 'rgba(245, 158, 11, 0.45)';
            statusPill.style.color = '#fbbf24';
            statusPill.innerHTML = `<span class="status-dot" style="background: #f59e0b; box-shadow: 0 0 8px #f59e0b;"></span><span>🖥️ รอหน้าจอ Random เชื่อมต่อห้อง ${currentPin}...</span>`;
          }
        }
      }, (err) => {
        console.warn("Heartbeat listener warning:", err);
      });

    state.unsubscribeGlobalStageHeartbeat = state.db.collection('AL_Reward').doc('_STAGE_ONLINE_GLOBAL_')
      .onSnapshot((doc) => {
        if (doc && doc.exists) {
          const alive = updateStageIndicator(doc.data(), (doc.data() && doc.data().roomPin));
          state.hasGlobalStageOnline = alive;
        } else {
          state.hasGlobalStageOnline = false;
        }
      }, () => {});
  }

  // ===========================================================================
  // INITIALIZATION & REAL-TIME LISTENERS
  // ===========================================================================
  function init() {
    // 1. Initialize Firebase
    if (typeof window.initFirebase === 'function') {
      const fb = window.initFirebase();
      if (fb && fb.db) {
        state.db = fb.db;
      }
    } else if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
      state.db = firebase.firestore();
    }

    // 2. Fallback localStorage data
    try {
      const savedR = localStorage.getItem('AL_REWARDS_DATA');
      if (savedR) state.rewards = JSON.parse(savedR);
    } catch (e) {}

    try {
      const savedE = localStorage.getItem('AL_EMPLOYEES_DATA');
      if (savedE) state.employees = JSON.parse(savedE);
    } catch (e) {}

    renderAllUI();

    // 3. Firestore Listeners
    if (state.db) {
      // Rewards Listener
      state.db.collection(state.rewardsCollection)
        .orderBy('order', 'asc')
        .onSnapshot(snapshot => {
          const list = [];
          snapshot.forEach(doc => {
            if (doc.id.startsWith('_') || (doc.data() && doc.data().isControlDoc)) return;
            list.push({ id: doc.id, ...doc.data() });
          });
          list.sort(compareRewardGroups);
          state.rewards = list;
          renderAllUI();
        }, err => console.warn("Remote rewards error:", err));

      // Employees Listener
      state.db.collection(state.employeesCollection)
        .onSnapshot(snapshot => {
          const list = [];
          snapshot.forEach(doc => {
            list.push({ id: doc.id, ...doc.data() });
          });
          state.employees = list;
          renderAllUI();
        }, err => console.warn("Remote employees error:", err));

      // Status Pill
      const statusPill = document.getElementById('remoteConnStatus');
      if (statusPill) {
        statusPill.classList.remove('offline');
        statusPill.innerHTML = '<span class="status-dot"></span><span>Real-time Live (Firestore)</span>';
      }

      // Stage Heartbeat Listener (ตรวจสอบว่าหน้าจอบนเวทีกำลังเปิดอยู่หรือไม่)
      listenToStageHeartbeat();
    }

    // 4. Room PIN Input Init
    const inputPin = document.getElementById('inputRoomPin');
    if (inputPin) {
      inputPin.value = state.roomPin || 'AL2026';
    }

    // 5. BroadcastChannel Sync
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const currentPin = String(state.roomPin || 'AL2026').trim().toUpperCase();
        const ch = new BroadcastChannel('AL_REALTIME_SYNC_' + currentPin);
        ch.onmessage = (e) => {
          if (!e.data) return;
          if (e.data.type === 'DATABASE_SYNC' && e.data.employees) {
            state.employees = e.data.employees;
            renderAllUI();
          } else if (e.data.type === 'REWARDS_SYNC' && e.data.rewards) {
            state.rewards = e.data.rewards;
            renderAllUI();
          }
        };
      } catch (e) {}
    }

    // 5. Modal Backdrop & Key Events
    window.addEventListener('click', (e) => {
      const modalGroupDraw = document.getElementById('remoteGroupDrawConfirmModal');
      const modalDraw = document.getElementById('remoteExtraDrawConfirmModal');
      const modalRedraw = document.getElementById('remoteRedrawModal');
      if (e.target === modalGroupDraw) {
        window.closeGroupDrawConfirmModal();
      }
      if (e.target === modalDraw) {
        window.closeExtraDrawConfirmModal();
      }
      if (e.target === modalRedraw) {
        window.closeExtraRedrawModal();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.closeGroupDrawConfirmModal();
        window.closeExtraDrawConfirmModal();
        window.closeExtraRedrawModal();
      }
    });
  }

  // Run on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

