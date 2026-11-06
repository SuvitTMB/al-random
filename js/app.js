/**
 * AL Drive Forum Special - Employee Registration
 * Core Application Logic connected with Firebase Firestore (AL_Employee)
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const regForm = document.getElementById('regForm');
  const empIdInput = document.getElementById('empId');
  const formGroup = document.getElementById('formGroupEmpId');
  const feedbackMsg = document.getElementById('feedbackMsg');
  const btnClear = document.getElementById('btnClear');
  const btnSubmit = document.getElementById('btnSubmit');

  // Modal Elements
  const successModal = document.getElementById('successModal');
  const modalEmpId = document.getElementById('modalEmpId');
  const modalEmpName = document.getElementById('modalEmpName');
  const modalEmpBranch = document.getElementById('modalEmpBranch');
  const rowEmpName = document.getElementById('rowEmpName');
  const rowEmpBranch = document.getElementById('rowEmpBranch');
  const modalRegTime = document.getElementById('modalRegTime');
  const modalTicketCode = document.getElementById('modalTicketCode');
  const btnModalClose = document.getElementById('btnModalClose');

  // Claim Confirmation Modal Elements
  const claimConfirmModal = document.getElementById('claimConfirmModal');
  const claimModalEmpId = document.getElementById('claimModalEmpId');
  const claimModalEmpName = document.getElementById('claimModalEmpName');
  const claimModalPrizeName = document.getElementById('claimModalPrizeName');
  const claimModalPrizeImg = document.getElementById('claimModalPrizeImg');
  const claimModalPrizeFallback = document.getElementById('claimModalPrizeFallback');
  const claimModalOwnerRow = document.getElementById('claimModalOwnerRow');
  const claimModalOwnerName = document.getElementById('claimModalOwnerName');
  const claimModalOwnerPos = document.getElementById('claimModalOwnerPos');
  const btnClaimModalConfirm = document.getElementById('btnClaimModalConfirm');
  const btnClaimModalCancel = document.getElementById('btnClaimModalCancel');
  const claimModalBtnText = document.getElementById('claimModalBtnText');
  let activeClaimEmp = null;

  // Firebase & Real-time Channel Setup
  let db = null;
  const collectionName = (window.DB_PATHS && window.DB_PATHS.AL_EMPLOYEE) || "AL_Employee";
  const rewardsCollectionName = (window.DB_PATHS && window.DB_PATHS.AL_REWARD) || "AL_Reward";
  const realtimeChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('AL_REALTIME_SYNC') : null;
  const rewardsChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('AL_REWARDS_SYNC') : null;
  let cachedEmployeeList = [];
  let cachedRewardsList = [];
  let currentViewingEmp = null;

  // =============================================================================
  // PERFORMANCE & ANTI-RELOAD / ANTI-FLICKER GUARDS FOR HIGH-CONCURRENCY TRAFFIC
  // (ระบบป้องกันการโหลดหน้าจอซ้ำซ้อน และลดภาระ Database เมื่อมีผู้ใช้งานจำนวนมาก)
  // =============================================================================
  let personalDocUnsubscribe = null;
  let lastRenderedUserSignature = '';
  let lastRenderedDrawStateKey = '';
  let lastRenderedMedalKey = '';
  let uiRenderTimeout = null;
  let isAllDrawnGlobal = false;
  let cachedAllDrawnResult = false;
  let lastAllDrawnCheckTime = 0;

  function computeUserSignature(emp) {
    if (!emp) return '';
    return [
      emp.EmployeeID || '',
      emp.RewardName || '',
      emp.RewardStatus || '',
      emp.RewardClaimedTime || '',
      emp.RewardDrawTime || '',
      emp.MemberDate || '',
      emp.isRegistered ? '1' : '0'
    ].join('::');
  }

  function scheduleUserUIRender() {
    if (uiRenderTimeout) return;
    uiRenderTimeout = setTimeout(() => {
      uiRenderTimeout = null;
      if (!currentViewingEmp) return;
      renderMemberMedalUI(currentViewingEmp);
      renderLuckyDrawResultUI(currentViewingEmp);
    }, 150);
  }

  function attachPersonalDocumentListener(cleanId) {
    if (!cleanId) return;
    if (personalDocUnsubscribe) {
      personalDocUnsubscribe();
      personalDocUnsubscribe = null;
    }

    if (!db) return;

    try {
      // ดึงข้อมูลเฉพาะเอกสารของพนักงานรายนี้เท่านั้น (Single-Document onSnapshot)
      // ป้องกันการดาวน์โหลดข้อมูลพนักงานทุกคน ซึ่งทำให้เครื่องค้างและโหลดซ้ำตลอดเวลา
      personalDocUnsubscribe = db.collection(collectionName).doc(cleanId).onSnapshot((docSnap) => {
        if (!docSnap.exists) return;
        const updated = docSnap.data();
        handlePersonalUserUpdate(cleanId, updated);
      }, (err) => {
        console.warn("Personal user onSnapshot error:", err);
      });
    } catch (err) {
      console.warn("Error attaching personal onSnapshot:", err);
    }
  }

  function handlePersonalUserUpdate(cleanId, updated) {
    if (!currentViewingEmp) return;
    const newSignature = computeUserSignature(updated);
    if (newSignature === lastRenderedUserSignature) {
      // ข้อมูลผู้ใช้ไม่มีการเปลี่ยนแปลง ป้องกันการโหลดหรือวาดหน้าจอซ้ำ
      return;
    }

    const hadNoRewardBefore = !currentViewingEmp.RewardName || currentViewingEmp.RewardName === '-' || String(currentViewingEmp.RewardName).trim() === '';
    const hasRewardNow = updated.RewardName && updated.RewardName !== '-' && String(updated.RewardName).trim() !== '';

    lastRenderedUserSignature = newSignature;
    currentViewingEmp = { ...currentViewingEmp, ...updated };

    // บันทึกลง SessionStorage และ LocalStorage เพื่อไม่ต้องโหลดซ้ำ
    try {
      sessionStorage.setItem('AL_CACHED_USER_' + cleanId, JSON.stringify(currentViewingEmp));
      localStorage.setItem('AL_SAVED_EMPLOYEE_ID', cleanId);
    } catch (e) {}

    scheduleUserUIRender();

    if (hadNoRewardBefore && hasRewardNow) {
      fireConfetti();
    }
  }

  const liveRegisteredCount = document.getElementById('liveRegisteredCount');

  function updateLiveCountUI(count) {
    if (liveRegisteredCount) {
      liveRegisteredCount.textContent = Number(count || 0).toLocaleString();
    }
  }

  function getLocalEmployees() {
    try {
      const raw = localStorage.getItem('AL_EMPLOYEES_DATA');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function getLocalRewards() {
    try {
      const raw = localStorage.getItem('AL_REWARDS_DATA');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function recalculateLiveCountFromLocal() {
    const list = getLocalEmployees();
    cachedEmployeeList = list;
    const regCount = list.filter(x => x.isRegistered).length;
    updateLiveCountUI(regCount);
  }

  async function fetchInitialRegistrationCount() {
    recalculateLiveCountFromLocal();
    if (db) {
      try {
        const querySnap = await db.collection(collectionName).where('isRegistered', '==', true).get();
        if (querySnap && !querySnap.empty) {
          updateLiveCountUI(querySnap.size);
        }
      } catch (e) {
        recalculateLiveCountFromLocal();
      }
    }
  }

  function syncCurrentViewingEmployee(list) {
    if (!currentViewingEmp || !Array.isArray(list)) return;
    const cleanId = String(currentViewingEmp.EmployeeID).trim();
    const updated = list.find(x => String(x.EmployeeID).trim() === cleanId);
    if (updated) {
      handlePersonalUserUpdate(cleanId, updated);
    }
  }

  // Setup Real-time Listener on Firestore & BroadcastChannel
  function initRealtimeListeners() {
    // 1. Initial local count & rewards cache
    fetchInitialRegistrationCount();
    cachedRewardsList = getLocalRewards();

    // 2. BroadcastChannel for 0ms cross-tab real-time sync
    if (realtimeChannel) {
      realtimeChannel.onmessage = (event) => {
        const msg = event.data;
        if (!msg) return;
        if (msg.type === 'DATABASE_SYNC' && Array.isArray(msg.employees)) {
          cachedEmployeeList = msg.employees;
          const regCount = msg.employees.filter(x => x.isRegistered).length;
          updateLiveCountUI(regCount);
          syncCurrentViewingEmployee(msg.employees);
        } else if (msg.type === 'EMPLOYEE_REGISTERED') {
          recalculateLiveCountFromLocal();
        } else if (msg.type === 'MEMBER_MEDAL_CLAIMED') {
          if (currentViewingEmp && String(currentViewingEmp.EmployeeID).trim() === String(msg.employeeId).trim()) {
            currentViewingEmp.MemberDate = msg.memberDate;
            scheduleUserUIRender();
          }
        }
      };
    }

    if (rewardsChannel) {
      rewardsChannel.onmessage = (event) => {
        const msg = event.data;
        if (msg && Array.isArray(msg.rewards)) {
          cachedRewardsList = msg.rewards;
          if (currentViewingEmp) {
            scheduleUserUIRender();
          }
        }
      };
    }

    // 3. Storage event fallback
    window.addEventListener('storage', (e) => {
      if (e.key === 'AL_EMPLOYEES_DATA') {
        recalculateLiveCountFromLocal();
        if (currentViewingEmp) {
          syncCurrentViewingEmployee(getLocalEmployees());
        }
      } else if (e.key === 'AL_REWARDS_DATA') {
        cachedRewardsList = getLocalRewards();
        if (currentViewingEmp) {
          scheduleUserUIRender();
        }
      }
    });

    // 4. Firestore lightweight listener for Rewards (คอลเลกชันขนาดเล็กมาก ~10-20 รายการ)
    if (db) {
      try {
        db.collection(rewardsCollectionName).onSnapshot((snapshot) => {
          const rList = [];
          snapshot.forEach(doc => {
            if (doc.id.startsWith('_CONTROL_')) {
              const cData = doc.data();
              if (cData && typeof cData.allPrizesDrawn === 'boolean') {
                isAllDrawnGlobal = cData.allPrizesDrawn;
              }
              return;
            }
            if (doc.id.startsWith('_') || (doc.data() && doc.data().isControlDoc)) return;
            rList.push({ id: doc.id, ...doc.data() });
          });
          if (rList.length > 0) {
            cachedRewardsList = rList;
          }
          if (currentViewingEmp) {
            scheduleUserUIRender();
          }
        }, (err) => {
          console.warn("Rewards onSnapshot warning:", err);
        });
      } catch (err) {
        console.warn("Error attaching rewards onSnapshot:", err);
      }
    }
  }

  try {
    if (typeof window.initFirebase === 'function') {
      const fb = window.initFirebase();
      if (fb && fb.db) {
        db = fb.db;
      }
    }
  } catch (e) {
    console.warn("Firebase init in app.js:", e);
  }

  initRealtimeListeners();

  // Input Clear Button Toggle & Restrict input to digits only
  empIdInput.addEventListener('input', () => {
    // ให้กรอกเฉพาะตัวเลขเท่านั้น
    const original = empIdInput.value;
    const numericOnly = original.replace(/\D/g, '');
    if (original !== numericOnly) {
      empIdInput.value = numericOnly;
    }
    const val = empIdInput.value.trim();
    if (val.length > 0) {
      btnClear.classList.add('is-visible');
    } else {
      btnClear.classList.remove('is-visible');
    }
    clearError();
  });

  empIdInput.addEventListener('keypress', (e) => {
    // อนุญาตเฉพาะตัวเลข 0-9
    if (!/[0-9]/.test(e.key) && e.key !== 'Enter') {
      e.preventDefault();
    }
  });

  empIdInput.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasteData = (e.clipboardData || window.clipboardData).getData('text');
    const numericOnly = pasteData.replace(/\D/g, '');
    document.execCommand('insertText', false, numericOnly);
  });

  btnClear.addEventListener('click', () => {
    empIdInput.value = '';
    btnClear.classList.remove('is-visible');
    clearError();
    empIdInput.focus();
  });

  // Validation functions
  function showError(message) {
    formGroup.classList.add('has-error');
    feedbackMsg.textContent = message;
    empIdInput.focus();
  }

  function clearError() {
    formGroup.classList.remove('has-error');
    feedbackMsg.textContent = '';
  }

  function validateEmployeeId(id) {
    if (!id || id.trim() === '') {
      return { valid: false, message: 'กรุณากรอกรหัสพนักงาน' };
    }
    const cleanId = id.trim().replace(/\D/g, '');
    if (!cleanId) {
      return { valid: false, message: 'รหัสพนักงานต้องเป็นตัวเลขเท่านั้น' };
    }
    if (cleanId.length < 4) {
      return { valid: false, message: 'รหัสพนักงานต้องมีความยาวอย่างน้อย 4 หลัก' };
    }
    return { valid: true, cleanId };
  }

  // Handle Form Submission
  regForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const validation = validateEmployeeId(empIdInput.value);
    if (!validation.valid) {
      showError(validation.message);
      return;
    }

    const employeeId = validation.cleanId;

    // Set Loading State
    btnSubmit.classList.add('is-loading');

    // Register into Firebase Firestore or LocalStorage
    try {
      await processRegistration(employeeId);
    } catch (err) {
      console.warn("Registration processing error:", err);
      // Fallback display
      showSuccess(employeeId, null);
    } finally {
      btnSubmit.classList.remove('is-loading');
    }
  });

  // Helper to format registeredAt string into Thai readable time
  function formatRegisteredDisplayTime(registeredAtStr) {
    if (!registeredAtStr || registeredAtStr === '-' || registeredAtStr === 'null') {
      const now = new Date();
      const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      return `${now.getDate()} ${thaiMonths[now.getMonth()]} ${now.getFullYear() + 543} เวลา ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} น.`;
    }
    const str = String(registeredAtStr).trim();
    if (str.includes('เวลา')) {
      return str;
    }
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
    if (match) {
      const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      const mIdx = parseInt(match[2], 10) - 1;
      const mName = thaiMonths[mIdx] || match[2];
      const d = parseInt(match[3], 10);
      const y = match[1];
      const hh = match[4];
      const mm = match[5];
      return `${d} ${mName} ${y} เวลา ${hh}:${mm} น.`;
    }
    return str;
  }

  async function processRegistration(empId) {
    const cleanId = String(empId).trim();
    const now = new Date();
    const thaiMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    const day = now.getDate();
    const month = thaiMonths[now.getMonth()];
    const year = now.getFullYear() + 543;
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const formattedDisplayTime = `${day} ${month} ${year} เวลา ${hours}:${minutes} น.`;
    const formattedTimestamp = `${now.getFullYear() + 543}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')} ${hours}:${minutes}:${seconds}`;

    let empData = null;
    let isAlreadyRegistered = false;

    // 1. ตรวจสอบข้อมูลจากแคชพนักงานหรือ LocalStorage ก่อน
    const localList = cachedEmployeeList && cachedEmployeeList.length > 0 ? cachedEmployeeList : getLocalEmployees();
    const foundLocal = localList.find(x => String(x.EmployeeID).trim() === cleanId);
    if (foundLocal) {
      empData = { ...foundLocal };
      if (foundLocal.isRegistered) {
        isAlreadyRegistered = true;
      }
    }

    // 2. ตรวจสอบจาก Firebase Firestore (ถ้าเชื่อมต่ออยู่)
    let docRef = null;
    let targetDocRef = null;
    if (db) {
      try {
        docRef = db.collection(collectionName).doc(cleanId);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
          const docData = docSnap.data();
          empData = { ...empData, ...docData };
          if (docData.isRegistered) {
            isAlreadyRegistered = true;
          }
        } else {
          // Check query by EmployeeID field
          const querySnap = await db.collection(collectionName).where('EmployeeID', '==', cleanId).limit(1).get();
          if (!querySnap.empty) {
            const targetDoc = querySnap.docs[0];
            targetDocRef = targetDoc.ref;
            const targetData = targetDoc.data();
            empData = { ...empData, ...targetData };
            if (targetData.isRegistered) {
              isAlreadyRegistered = true;
            }
          }
        }
      } catch (err) {
        console.warn("Firestore registration check error:", err);
      }
    }

    // =========================================================================
    // เมื่อผู้ใช้งานลงทะเบียนไปแล้ว และมาลงทะเบียนซ้ำ:
    // ระบบไม่ต้องทำการบันทึกรายการใหม่ลงไป ให้ดึงรายการเดิมกลับมาแสดงผล
    // =========================================================================
    if (isAlreadyRegistered) {
      const existingRegisteredAt = (empData && empData.registeredAt) ? empData.registeredAt : formattedTimestamp;
      const displayTime = formatRegisteredDisplayTime(existingRegisteredAt);
      const ticketCode = (empData && (empData.ticketCode || empData.TicketCode))
        ? (empData.ticketCode || empData.TicketCode)
        : `TTB-2026-${Math.floor(1000 + Math.random() * 9000)}`;

      // จำรหัสพนักงานใน LocalStorage เพื่อให้สามารถเปิดดูผลได้ตลอดเวลา
      try {
        localStorage.setItem('AL_SAVED_EMPLOYEE_ID', cleanId);
      } catch (e) {}

      const groupVal = empData ? empData.Group : '';
      if (hasValidGroup(groupVal)) {
        showRewardPage(cleanId, empData, displayTime, ticketCode);
      } else {
        showSuccess(cleanId, empData, displayTime, ticketCode);
      }
      return;
    }

    // =========================================================================
    // กรณีเป็นการลงทะเบียนครั้งแรก (New Registration)
    // =========================================================================
    const ticketCode = `TTB-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    if (db) {
      try {
        if (targetDocRef) {
          await targetDocRef.set({
            isRegistered: true,
            registeredAt: formattedTimestamp,
            ticketCode: ticketCode
          }, { merge: true });
        } else if (docRef) {
          const payload = {
            EmployeeID: cleanId,
            isRegistered: true,
            registeredAt: formattedTimestamp,
            ticketCode: ticketCode
          };
          if (empData && empData.EmpName) payload.EmpName = empData.EmpName;
          if (empData && empData.Group) payload.Group = empData.Group;
          if (empData && empData.EmpPosition) payload.EmpPosition = empData.EmpPosition;
          if (empData && empData.EmpBranch) payload.EmpBranch = empData.EmpBranch;
          if (empData && empData.EmpZone) payload.EmpZone = empData.EmpZone;
          if (empData && empData.EmpRH) payload.EmpRH = empData.EmpRH;
          if (empData && empData.Member) payload.Member = empData.Member;
          await docRef.set(payload, { merge: true });
        }
      } catch (err) {
        console.warn("Firestore registration save error, using local fallback:", err);
      }
    }

    // อัปเดตข้อมูลใน LocalStorage เฉพาะการลงทะเบียนใหม่
    try {
      const raw = localStorage.getItem('AL_EMPLOYEES_DATA');
      if (raw) {
        const list = JSON.parse(raw);
        const idx = list.findIndex(x => String(x.EmployeeID).trim() === cleanId);
        if (idx !== -1) {
          list[idx].isRegistered = true;
          list[idx].registeredAt = formattedTimestamp;
          list[idx].ticketCode = ticketCode;
          empData = { ...list[idx], ...empData, isRegistered: true, registeredAt: formattedTimestamp, ticketCode: ticketCode };
        } else {
          const newEmpItem = {
            EmployeeID: cleanId,
            EmpName: empData ? empData.EmpName : '',
            EmpPosition: empData ? empData.EmpPosition : '',
            EmpBranch: empData ? empData.EmpBranch : '',
            EmpZone: empData ? empData.EmpZone : '',
            EmpRH: empData ? empData.EmpRH : 'RH5',
            Group: empData ? empData.Group : '',
            Member: empData ? empData.Member : '',
            isRegistered: true,
            registeredAt: formattedTimestamp,
            ticketCode: ticketCode
          };
          list.unshift(newEmpItem);
          empData = { ...newEmpItem, ...empData };
        }
        localStorage.setItem('AL_EMPLOYEES_DATA', JSON.stringify(list));
      }
    } catch (e) {}

    // ส่งสัญญาณ Real-time broadcast เฉพาะการลงทะเบียนใหม่
    if (realtimeChannel) {
      realtimeChannel.postMessage({
        type: 'EMPLOYEE_REGISTERED',
        employeeId: cleanId,
        empName: empData ? empData.EmpName : '',
        empPosition: empData ? empData.EmpPosition : '',
        empBranch: empData ? empData.EmpBranch : '',
        empZone: empData ? empData.EmpZone : '',
        empRH: empData ? empData.EmpRH : 'RH5',
        group: empData ? empData.Group : '',
        member: empData ? empData.Member : '',
        timestamp: formattedTimestamp
      });
    }

    recalculateLiveCountFromLocal();

    const groupVal = empData ? empData.Group : '';
    if (hasValidGroup(groupVal)) {
      showRewardPage(cleanId, empData, formattedDisplayTime, ticketCode);
    } else {
      showSuccess(cleanId, empData, formattedDisplayTime, ticketCode);
    }
  }

  // Validate Group field (not empty, not '-', not null)
  function hasValidGroup(group) {
    if (group === undefined || group === null) return false;
    const str = String(group).trim();
    return str !== '' && str !== '-' && str.toLowerCase() !== 'null' && str.toLowerCase() !== 'undefined';
  }

  // Show Dedicated Reward & Employee Details Page View
  function showRewardPage(employeeId, empData, customTimeStr, customTicketCode, isAuto = false) {
    const formattedTime = customTimeStr || `${new Date().getDate()} ต.ค. ${new Date().getFullYear() + 543} เวลา ${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')} น.`;
    const ticketCode = customTicketCode || `TTB-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    // Set current active employee viewing this page
    currentViewingEmp = { ...(empData || {}), EmployeeID: employeeId };

    const cleanId = String(employeeId).trim();
    // Remember employee ID in localStorage & sessionStorage
    try {
      localStorage.setItem('AL_SAVED_EMPLOYEE_ID', cleanId);
      sessionStorage.setItem('AL_CACHED_USER_' + cleanId, JSON.stringify(currentViewingEmp));
    } catch (e) {}

    // ผูก listener เฉพาะเอกสารของตนเอง เพื่อป้องกันการโหลดข้อมูลของผู้อื่นซ้ำซ้อน
    attachPersonalDocumentListener(cleanId);

    const pageEmpId = document.getElementById('pageEmpId');
    const pageEmpName = document.getElementById('pageEmpName');
    const pageEmpPosition = document.getElementById('pageEmpPosition');
    const pageEmpGroup = document.getElementById('pageEmpGroup');
    const pageEmpBranch = document.getElementById('pageEmpBranch');
    const pageEmpZone = document.getElementById('pageEmpZone');
    const pageEmpRH = document.getElementById('pageEmpRH');
    const pageRegTime = document.getElementById('pageRegTime');
    const pageTicketCode = document.getElementById('pageTicketCode');
    const pageAvatarLetter = document.getElementById('pageAvatarLetter');

    if (pageEmpId) pageEmpId.textContent = employeeId;
    const fullName = (empData && empData.EmpName) ? empData.EmpName : 'พนักงาน ttb';
    if (pageEmpName) pageEmpName.textContent = fullName;
    if (pageAvatarLetter) {
      const firstChar = fullName.trim().charAt(0) || 'พ';
      pageAvatarLetter.textContent = firstChar;
    }
    if (pageEmpPosition) pageEmpPosition.textContent = (empData && empData.EmpPosition) ? empData.EmpPosition : '-';

    const grp = (empData && empData.Group) ? String(empData.Group).trim() : 'BBD';
    if (pageEmpGroup) {
      pageEmpGroup.textContent = grp;
      pageEmpGroup.className = `badge-group-chip badge-group-${grp}`;
    }

    if (pageEmpBranch) pageEmpBranch.textContent = (empData && empData.EmpBranch) ? empData.EmpBranch : '-';
    if (pageEmpZone) pageEmpZone.textContent = (empData && empData.EmpZone) ? empData.EmpZone : '-';
    if (pageEmpRH) pageEmpRH.textContent = (empData && empData.EmpRH) ? empData.EmpRH : 'RH5';
    if (pageRegTime) pageRegTime.textContent = formattedTime;
    if (pageTicketCode) pageTicketCode.textContent = ticketCode;

    // Render Real-time Member Medal UI
    renderMemberMedalUI(currentViewingEmp);

    // Render Real-time Lucky Draw Results (Waiting, Won Prize, or Not Won)
    renderLuckyDrawResultUI(currentViewingEmp);

    // Transition from registrationView to rewardPageView
    const regView = document.getElementById('registrationView');
    const rewardView = document.getElementById('rewardPageView');

    if (regView) regView.style.display = 'none';
    if (rewardView) {
      rewardView.style.display = 'block';
    }

    // Scroll to top
    const scrollContainer = document.querySelector('.app-scroll-container');
    if (scrollContainer) scrollContainer.scrollTop = 0;

    // Fire celebratory Confetti only when newly submitting, not on auto-login reload
    if (!isAuto) {
      fireConfetti();
    }
  }

  // Check if all prizes quota has been completely drawn
  function isAllPrizesDrawn() {
    if (isAllDrawnGlobal) return true;

    const now = Date.now();
    if (now - lastAllDrawnCheckTime < 8000) {
      return cachedAllDrawnResult;
    }
    lastAllDrawnCheckTime = now;

    const rawRewards = cachedRewardsList && cachedRewardsList.length > 0 ? cachedRewardsList : getLocalRewards();
    if (!rawRewards || rawRewards.length === 0) {
      cachedAllDrawnResult = false;
      return false;
    }

    const rawEmployees = cachedEmployeeList && cachedEmployeeList.length > 0 ? cachedEmployeeList : getLocalEmployees();

    let totalQuota = 0;
    let totalDrawn = 0;

    rawRewards.forEach((r, idx) => {
      const q = Number(r.quantity) || 1;
      totalQuota += q;
      const prizeName = String(r.name || `รางวัลที่ ${idx + 1}`).trim().toLowerCase();
      const drawnForThis = rawEmployees.filter(e => e.RewardName && String(e.RewardName).trim().toLowerCase() === prizeName).length;
      totalDrawn += Math.min(q, drawnForThis);
    });

    cachedAllDrawnResult = totalQuota > 0 && totalDrawn >= totalQuota;
    return cachedAllDrawnResult;
  }

  // =============================================================================
  // MEMBER MEDAL UI & CLAIM LOGIC (การรับเหรียญรางวัลเกียรติยศ)
  // =============================================================================
  function renderMemberMedalUI(empData) {
    const card = document.getElementById('memberMedalSectionCard');
    const body = document.getElementById('memberMedalCardBody');
    const tagText = document.getElementById('medalTagText');
    const luckyDrawCard = document.getElementById('luckyDrawSectionCard');
    if (!card || !body) return;

    // ตรวจสอบฟิลด์ Member ว่ามีข้อมูลหรือไม่
    if (!empData || !empData.Member || String(empData.Member).trim() === '' || String(empData.Member).trim() === '-' || String(empData.Member).toLowerCase() === 'null') {
      card.style.display = 'none';
      lastRenderedMedalKey = 'none';
      return;
    }

    const memberVal = String(empData.Member).trim();
    const hasClaimed = !!(empData.MemberDate && String(empData.MemberDate).trim() !== '' && String(empData.MemberDate).trim() !== '-' && String(empData.MemberDate).toLowerCase() !== 'null');

    // ตรวจสอบสถานะเดิมเพื่อป้องกันการวาด DOM ซ้ำซ้อน (Anti-flicker)
    const currentMedalKey = `${memberVal}::${hasClaimed ? empData.MemberDate : 'pending'}`;
    if (currentMedalKey === lastRenderedMedalKey && card.style.display === 'block') {
      return; // ข้อมูลเดิม ไม่ต้องวาด DOM ใหม่
    }
    lastRenderedMedalKey = currentMedalKey;

    // ย้ายตำแหน่งกล่องเหรียญรางวัล: เมื่อรับเหรียญแล้วให้ย้ายไปอยู่ด้านล่างกล่องตรวจสอบผลการจับรางวัล
    if (luckyDrawCard && luckyDrawCard.parentNode) {
      if (hasClaimed) {
        luckyDrawCard.after(card);
      } else {
        luckyDrawCard.before(card);
      }
    }

    card.style.display = 'block';
    const imgSrc = `./gift/${encodeURI(memberVal)}.png`;

    if (hasClaimed) {
      // เงื่อนไข 1: Member ไม่ใช่ค่าว่าง/null และ MemberDate ไม่ใช่ค่าว่าง/null
      // แสดงกล่องการรับเหรียญรางวัล และชื่อเหรียญรางวัล (ฟิลด์ Member)
      if (tagText) tagText.textContent = 'รับเหรียญแล้ว';
      body.innerHTML = `
        <div class="medal-img-wrapper">
          <img src="${imgSrc}" alt="${escapeHtml(memberVal)}" class="medal-hero-img animate-float" onerror="this.onerror=null; this.src='./images/logo_w.png';">
        </div>
        <h3 class="medal-name-title">เหรียญรางวัล ${escapeHtml(memberVal)}</h3>
        <div class="medal-status-pill claimed">
          <span>✓</span>
          <span>รับเหรียญรางวัลแล้ว</span>
        </div>
        <div class="medal-time-stamp">
          บันทึกรับเหรียญเมื่อ: <strong>${escapeHtml(empData.MemberDate)}</strong>
        </div>
      `;
    } else {
      // เงื่อนไข 2: MemberDate เป็นค่าว่างหรือค่า null
      // แสดงกล่องรูปเหรียญรางวัลตามรูป ชื่อฟิวด์.png และมีปุ่มเพื่อกดรับรางวัล
      if (tagText) tagText.textContent = 'รอรับเหรียญ';
      body.innerHTML = `
        <div class="medal-img-wrapper">
          <img src="${imgSrc}" alt="${escapeHtml(memberVal)}" class="medal-hero-img pulse-glow" onerror="this.onerror=null; this.src='./images/logo_w.png';">
        </div>
        <h3 class="medal-name-title">เหรียญรางวัล ${escapeHtml(memberVal)}</h3>
        <p class="medal-desc">คุณมีสิทธิ์ได้รับเหรียญรางวัลเกียรติยศประจำ ${escapeHtml(memberVal)} กรุณากดปุ่มเพื่อยืนยันการรับเหรียญรางวัล</p>
        <button type="button" class="btn-claim-medal" id="btnClaimMedal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <circle cx="12" cy="8" r="6"></circle>
            <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"></path>
          </svg>
          <span>กดรับรางวัล</span>
        </button>
      `;

      const btnClaim = document.getElementById('btnClaimMedal');
      if (btnClaim) {
        btnClaim.addEventListener('click', () => handleClaimMedal(empData));
      }
    }
  }

  async function handleClaimMedal(empData) {
    if (!empData) return;
    const btnClaim = document.getElementById('btnClaimMedal');
    if (btnClaim) {
      btnClaim.disabled = true;
      btnClaim.innerHTML = `
        <svg class="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px; animation: spin 1s linear infinite;">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
          <path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="1"></path>
        </svg>
        <span>กำลังบันทึกการรับรางวัล...</span>
      `;
    }

    const cleanId = String(empData.EmployeeID).trim();
    const now = new Date();
    const formattedTimestamp = `${now.getFullYear() + 543}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    empData.MemberDate = formattedTimestamp;
    if (currentViewingEmp && String(currentViewingEmp.EmployeeID).trim() === cleanId) {
      currentViewingEmp.MemberDate = formattedTimestamp;
    }

    // 1. Update in Firestore
    if (db) {
      try {
        await db.collection(collectionName).doc(cleanId).set({
          MemberDate: formattedTimestamp
        }, { merge: true });
      } catch (e) {
        console.warn("Firestore MemberDate save error:", e);
      }
    }

    // 2. Update in LocalStorage
    try {
      const raw = localStorage.getItem('AL_EMPLOYEES_DATA');
      if (raw) {
        const list = JSON.parse(raw);
        const idx = list.findIndex(x => String(x.EmployeeID).trim() === cleanId);
        if (idx !== -1) {
          list[idx].MemberDate = formattedTimestamp;
          localStorage.setItem('AL_EMPLOYEES_DATA', JSON.stringify(list));
        }
      }
    } catch (e) {}

    // 3. Broadcast real-time message
    if (realtimeChannel) {
      realtimeChannel.postMessage({
        type: 'MEMBER_MEDAL_CLAIMED',
        employeeId: cleanId,
        memberDate: formattedTimestamp,
        member: empData.Member
      });
    }

    // 4. Fire celebratory Confetti!
    fireConfetti();

    // 5. Re-render UI (ย้ายกล่องเหรียญรางวัลไปอยู่ด้านล่างกล่องตรวจสอบผลการจับรางวัล)
    renderMemberMedalUI(empData);

    setTimeout(() => {
      const updatedCard = document.getElementById('memberMedalSectionCard');
      if (updatedCard) {
        updatedCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 200);
  }

  // =============================================================================
  // REAL-TIME LUCKY DRAW RESULT RENDERING & CLAIM STATUS
  // =============================================================================
  function renderLuckyDrawResultUI(empData) {
    const container = document.getElementById('luckyDrawResultContainer');
    if (!container) return;

    if (!empData) {
      container.innerHTML = '';
      lastRenderedDrawStateKey = 'empty';
      return;
    }

    const hasReward = empData.RewardName && empData.RewardName !== '-' && String(empData.RewardName).trim() !== '';
    const allDrawn = hasReward ? false : isAllPrizesDrawn();

    // ตรวจสอบ Signature ของรางวัลเพื่อป้องกันการโหลดซ้ำและกระตุกหน้าจอ
    const currentDrawKey = [
      hasReward ? 'WON' : (allDrawn ? 'ALL_DRAWN' : 'WAITING'),
      empData.RewardName || '',
      empData.RewardStatus || '',
      empData.RewardClaimedTime || '',
      empData.RewardDrawTime || '',
      empData.RewardOwner || ''
    ].join('::');

    if (currentDrawKey === lastRenderedDrawStateKey && container.innerHTML.trim() !== '') {
      return; // ข้อมูลรางวัลไม่เปลี่ยน ไม่ต้องวาด DOM ใหม่ ป้องกันหน้าจอกระพริบ
    }
    lastRenderedDrawStateKey = currentDrawKey;

    if (!hasReward) {
      const allDrawn = isAllPrizesDrawn();

      if (allDrawn) {
        // STATE 3: ALL PRIZES DRAWN & THIS EMPLOYEE DID NOT WIN
        container.innerHTML = `
          <div class="not-won-prize-card">
            <div class="not-won-icon-circle">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="8" y1="12" x2="16" y2="12"></line>
              </svg>
            </div>
            <h4 class="not-won-headline">เสียใจด้วย คุณไม่ได้รับรางวัล</h4>
            <p class="not-won-desc">ระบบได้ทำการสุ่มรางวัลครบตามจำนวนรางวัลทั้งหมดเรียบร้อยแล้ว ขอขอบคุณที่ร่วมสนุกและร่วมเป็นส่วนหนึ่งของกิจกรรม AL Drive Forum Special</p>
            <div class="not-won-status-chip">
              <span class="not-won-dot"></span>
              <span>การสุ่มรางวัลสิ้นสุดลงแล้ว</span>
            </div>
          </div>
        `;
        return;
      }

      // STATE 1: WAITING FOR DRAW RESULTS
      container.innerHTML = `
        <div class="waiting-prize-card">
          <div class="waiting-radar-wrap">
            <div class="radar-ping"></div>
            <div class="waiting-icon-circle">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </div>
          </div>
          <h4 class="waiting-headline">ระบบกำลังเชื่อมต่อผลการสุ่มรางวัลแบบ Real-time</h4>
          <p class="waiting-desc">คุณมีสิทธิ์ลุ้นรับรางวัลในกิจกรรมนี้ เมื่อมีการจับรางวัลจากระบบ รายชื่อ รูปภาพ และของรางวัลจะแสดงขึ้นที่นี่ทันที</p>
          <div class="waiting-status-chip">
            <span class="live-pulse-dot"></span>
            <span>กำลังรอลุ้นรางวัล (Live Real-time Sync)</span>
          </div>
        </div>
      `;
      return;
    }

    // STATE 2: WON A PRIZE
    const rewardInfo = resolveRewardInfo(empData);
    const { hasOwner, ownerName, ownerPosition, displayImage } = rewardInfo;

    const isClaimed = empData.RewardStatus === 'รับรางวัลแล้ว';
    const claimedTimeStr = empData.RewardClaimedTime || empData.RewardTime || '';

    const fallbackChar = hasOwner ? '👤' : '🎁';
    const imgHtml = displayImage
      ? `<img src="${escapeHtml(displayImage)}" alt="${escapeHtml(hasOwner ? ownerName : empData.RewardName)}" class="prize-photo-img ${hasOwner ? 'is-owner-img' : ''}" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'prize-photo-fallback ${hasOwner ? 'is-owner-fallback' : ''}\\'>${fallbackChar}</div>';">`
      : `<div class="prize-photo-fallback ${hasOwner ? 'is-owner-fallback' : ''}">${fallbackChar}</div>`;

    const actionAreaHtml = isClaimed
      ? `
          <button type="button" class="btn-claim-action is-claimed" id="btnClaimReward" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>คุณได้รับรางวัลแล้ว</span>
          </button>
          <div class="claimed-datetime-badge">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>รับรางวัลเมื่อ: <strong>${escapeHtml(claimedTimeStr || 'รับรางวัลแล้ว')}</strong></span>
          </div>
        `
      : `
          <button type="button" class="btn-claim-action is-pending" id="btnClaimReward">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>ยืนยันรับรางวัลแล้ว</span>
          </button>
          <div class="claim-officer-notice">*** กดปุ่มนี้ต่อหน้าเจ้าหน้าที่เท่านั้น ***</div>
        `;

    const ownerInfoHtml = hasOwner ? `
      <div class="prize-owner-info-card">
        <div class="prize-owner-header">
          <svg class="prize-owner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          <span class="prize-owner-label-text">ผู้มอบรางวัล</span>
        </div>
        <div class="prize-owner-name">${escapeHtml(ownerName)}</div>
        ${ownerPosition ? `<div class="prize-owner-position-badge">${escapeHtml(ownerPosition)}</div>` : ''}
      </div>
    ` : '';

    container.innerHTML = `
      <div class="won-prize-card ${hasOwner ? 'has-owner' : ''}">
        <div class="won-prize-body">
          <div class="prize-photo-frame ${hasOwner ? 'is-owner-frame' : ''}">
            ${imgHtml}
          </div>
          <div class="prize-details-wrap">
            <span class="prize-type-label">ของรางวัลที่ได้รับ</span>
            <h3 class="prize-display-name">${escapeHtml(empData.RewardName)}</h3>
            ${ownerInfoHtml}
          </div>
        </div>

        <div class="won-prize-action-area">
          ${actionAreaHtml}
        </div>
      </div>
    `;

    const btnClaim = document.getElementById('btnClaimReward');
    if (!isClaimed && btnClaim) {
      btnClaim.addEventListener('click', () => {
        openClaimConfirmModal(empData);
      });
    }
  }

  /**
   * ค้นหาข้อมูลของรางวัลและผู้มอบรางวัล (Executive / Owner Info)
   * ตรวจสอบชื่อ ตำแหน่ง และรูปภาพของผู้มอบรางวัล
   */
  function resolveRewardInfo(empData) {
    if (!empData) return { hasOwner: false, displayImage: '' };
    const rawRewards = cachedRewardsList && cachedRewardsList.length > 0 ? cachedRewardsList : getLocalRewards();
    const cleanName = String(empData.RewardName || '').trim().toLowerCase();
    const cleanOwner = String(empData.RewardOwner || empData.RewardExecutive || '').trim().replace(/^นาย\s*/, '').toLowerCase();

    let matched = null;

    // 1. Match by RewardId
    if (empData.RewardId) {
      const targetId = String(empData.RewardId).trim();
      matched = rawRewards.find(r => r.id && String(r.id).trim() === targetId);
      if (!matched && targetId.startsWith('idx_')) {
        const idx = parseInt(targetId.replace('idx_', ''), 10);
        if (!isNaN(idx) && rawRewards[idx]) {
          matched = rawRewards[idx];
        }
      }
    }

    // 2. Match by Name and Owner (if owner provided on empData)
    if (!matched && cleanOwner) {
      matched = rawRewards.find(r => {
        const rName = String(r.name || '').trim().toLowerCase();
        const rOwner = String(r.owner || '').trim().replace(/^นาย\s*/, '').toLowerCase();
        return rName === cleanName && rOwner === cleanOwner;
      });
    }

    // 3. Match by RewardName
    if (!matched) {
      matched = rawRewards.find(r => r.name && String(r.name).trim().toLowerCase() === cleanName);
    }

    // Owner Name
    const rawOwner = (matched && (matched.owner || matched.executive)) ||
                     empData.RewardOwner ||
                     empData.RewardExecutive ||
                     '';
    const ownerName = String(rawOwner).trim();

    // Owner Position
    const rawPos = (matched && (matched.ownerPosition || matched.position || matched.executivePosition)) ||
                   empData.RewardPosition ||
                   empData.RewardOwnerPosition ||
                   '';
    const ownerPosition = String(rawPos).trim();

    // Owner Image
    const rawOwnerImg = (matched && (matched.ownerImage || matched.ownerImageUrl || matched.executiveImage)) ||
                        empData.RewardOwnerImage ||
                        empData.RewardExecutiveImage ||
                        '';
    const ownerImage = String(rawOwnerImg).trim();

    // Prize Image
    const rawPrizeImg = (matched && (matched.imageUrl || matched.image)) ||
                        empData.RewardImageUrl ||
                        '';
    const prizeImageUrl = String(rawPrizeImg).trim();

    // ตรวจสอบว่าของรางวัลมีข้อมูลผู้มอบรางวัล / ผู้บริหารหรือไม่
    const isGenericTtb = ownerName.toLowerCase() === 'ttb' && (!ownerPosition || ownerPosition === 'สำนักงานใหญ่');
    const hasOwner = Boolean(ownerName && ownerName !== '-' && !isGenericTtb);

    // หากมีผู้มอบรางวัล ให้ปรับรูปเป็นรูปของผู้ให้รางวัล (หากไม่มีรูปผู้บริหาร ให้ใช้ ./images/person.png หรือรูปของรางวัล)
    let displayImage = '';
    if (hasOwner) {
      displayImage = ownerImage || (prizeImageUrl ? prizeImageUrl : './images/person.png');
    } else {
      displayImage = prizeImageUrl;
    }

    return {
      matched,
      ownerName,
      ownerPosition,
      ownerImage,
      prizeImageUrl,
      hasOwner,
      displayImage
    };
  }

  function getFormattedCurrentThaiDateTime() {
    const now = new Date();
    const thaiMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    const day = now.getDate();
    const month = thaiMonths[now.getMonth()];
    const year = now.getFullYear() + 543;
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${year} เวลา ${hours}:${minutes} น.`;
  }

  // --- Claim Confirmation Lightbox Modal Handlers ---
  function openClaimConfirmModal(empData) {
    if (!empData) return;
    if (empData.RewardStatus === 'รับรางวัลแล้ว') return;
    activeClaimEmp = empData;

    if (claimModalEmpId) claimModalEmpId.textContent = empData.EmployeeID || '-';
    if (claimModalEmpName) claimModalEmpName.textContent = empData.EmpName || 'พนักงาน ttb';

    const rewardInfo = resolveRewardInfo(empData);
    const { hasOwner, ownerName, ownerPosition, displayImage } = rewardInfo;

    if (claimModalPrizeImg && claimModalPrizeFallback) {
      if (displayImage) {
        claimModalPrizeImg.src = displayImage;
        claimModalPrizeImg.style.display = 'block';
        claimModalPrizeFallback.style.display = 'none';
      } else {
        claimModalPrizeImg.src = '';
        claimModalPrizeImg.style.display = 'none';
        claimModalPrizeFallback.style.display = 'flex';
        claimModalPrizeFallback.textContent = hasOwner ? '👤' : '🎁';
      }
    }

    // เอา icon ออก และแสดงเฉพาะชื่อของรางวัล
    if (claimModalPrizeName) {
      claimModalPrizeName.textContent = (empData.RewardName && empData.RewardName.trim()) ? empData.RewardName.trim() : '-';
    }

    // จัดการแสดง/ซ่อน แถวผู้มอบรางวัลใน Lightbox Modal
    if (claimModalOwnerRow) {
      if (hasOwner) {
        claimModalOwnerRow.style.display = 'flex';
        if (claimModalOwnerName) claimModalOwnerName.textContent = ownerName || '-';
        if (claimModalOwnerPos) {
          if (ownerPosition) {
            claimModalOwnerPos.textContent = ownerPosition;
            claimModalOwnerPos.style.display = 'inline-block';
          } else {
            claimModalOwnerPos.textContent = '';
            claimModalOwnerPos.style.display = 'none';
          }
        }
      } else {
        claimModalOwnerRow.style.display = 'none';
      }
    }

    if (btnClaimModalConfirm) {
      btnClaimModalConfirm.disabled = false;
      if (claimModalBtnText) claimModalBtnText.textContent = 'ยืนยันรับรางวัลแล้ว';
    }

    if (claimConfirmModal) {
      claimConfirmModal.classList.add('is-active');
    }
  }

  function closeClaimConfirmModal() {
    if (claimConfirmModal) {
      claimConfirmModal.classList.remove('is-active');
    }
    activeClaimEmp = null;
  }

  async function handleConfirmClaimSubmission() {
    if (!activeClaimEmp) return;
    const empData = activeClaimEmp;
    if (empData.RewardStatus === 'รับรางวัลแล้ว') {
      closeClaimConfirmModal();
      return;
    }

    // Disable button in modal while saving
    if (btnClaimModalConfirm) {
      btnClaimModalConfirm.disabled = true;
      if (claimModalBtnText) claimModalBtnText.textContent = 'กำลังบันทึกข้อมูล...';
    }

    const claimedTimeStr = getFormattedCurrentThaiDateTime();
    const newStatus = 'รับรางวัลแล้ว';
    empData.RewardStatus = newStatus;
    empData.RewardClaimedTime = claimedTimeStr;

    // Update in cached list
    const cleanId = String(empData.EmployeeID).trim();
    const localList = cachedEmployeeList && cachedEmployeeList.length > 0 ? cachedEmployeeList : getLocalEmployees();
    const idx = localList.findIndex(x => String(x.EmployeeID).trim() === cleanId);
    if (idx !== -1) {
      localList[idx].RewardStatus = newStatus;
      localList[idx].RewardClaimedTime = claimedTimeStr;
      cachedEmployeeList = localList;
    }

    // Save to LocalStorage
    try {
      localStorage.setItem('AL_EMPLOYEES_DATA', JSON.stringify(localList));
    } catch (e) {}

    // Sync to Firestore
    if (db) {
      try {
        const docId = empData.id || cleanId;
        await db.collection(collectionName).doc(docId).set({
          RewardStatus: newStatus,
          RewardClaimedTime: claimedTimeStr
        }, { merge: true });
      } catch (err) {
        console.warn("Firestore reward status update error:", err);
      }
    }

    // Broadcast to other windows/tabs (e.g. Admin Lucky Winners table)
    if (realtimeChannel) {
      try {
        realtimeChannel.postMessage({
          type: 'DATABASE_SYNC',
          employees: localList
        });
      } catch (e) {}
    }

    // เมื่อบันทึกรายการเสร็จให้ปิดหน้าต่างนี้
    closeClaimConfirmModal();

    // Fire celebratory confetti
    fireConfetti();

    // Re-render UI (ปุ่ม คุณได้รับรางวัลแล้ว จะ disabled)
    renderLuckyDrawResultUI(empData);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Success Celebration & Modal Display (For employees without group)
  function showSuccess(employeeId, empData, customTimeStr, customTicketCode) {
    const formattedTime = customTimeStr || `${new Date().getDate()} ต.ค. ${new Date().getFullYear() + 543} เวลา ${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')} น.`;
    const ticketCode = customTicketCode || `TTB-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    modalEmpId.textContent = employeeId;
    modalRegTime.textContent = formattedTime;
    modalTicketCode.textContent = ticketCode;

    if (empData && empData.EmpName) {
      if (modalEmpName && rowEmpName) {
        modalEmpName.textContent = empData.EmpName;
        rowEmpName.style.display = 'flex';
      }
      if (modalEmpBranch && rowEmpBranch) {
        const branchGroup = [empData.EmpBranch, empData.Group ? `(${empData.Group})` : ''].filter(Boolean).join(' ');
        modalEmpBranch.textContent = branchGroup || '-';
        rowEmpBranch.style.display = 'flex';
      }
    } else {
      if (rowEmpName) rowEmpName.style.display = 'none';
      if (rowEmpBranch) rowEmpBranch.style.display = 'none';
    }

    // Show Modal
    successModal.classList.add('is-active');

    // Fire Confetti!
    fireConfetti();
  }

  // Confetti Animation Effect
  function fireConfetti() {
    if (typeof confetti === 'function') {
      const count = 200;
      const defaults = {
        origin: { y: 0.65 },
        zIndex: 9999
      };

      function fire(particleRatio, opts) {
        confetti(Object.assign({}, defaults, opts, {
          particleCount: Math.floor(count * particleRatio)
        }));
      }

      fire(0.25, {
        spread: 26,
        startVelocity: 55,
        colors: ['#1255ea', '#ff6b00', '#ffd600']
      });
      fire(0.2, {
        spread: 60,
        colors: ['#ffffff', '#2979ff', '#ff8c00']
      });
      fire(0.35, {
        spread: 100,
        decay: 0.91,
        scalar: 0.8
      });
      fire(0.1, {
        spread: 120,
        startVelocity: 25,
        decay: 0.92,
        scalar: 1.2
      });
      fire(0.1, {
        spread: 120,
        startVelocity: 45,
      });
    }
  }

  // Close Modal
  function closeModal() {
    successModal.classList.remove('is-active');
    empIdInput.value = '';
    btnClear.classList.remove('is-visible');
    empIdInput.focus();
  }

  btnModalClose.addEventListener('click', closeModal);
  successModal.addEventListener('click', (e) => {
    if (e.target === successModal) {
      closeModal();
    }
  });

  // Claim Confirm Lightbox Modal Event Listeners
  if (btnClaimModalCancel) {
    btnClaimModalCancel.addEventListener('click', closeClaimConfirmModal);
  }
  if (btnClaimModalConfirm) {
    btnClaimModalConfirm.addEventListener('click', handleConfirmClaimSubmission);
  }
  if (claimConfirmModal) {
    claimConfirmModal.addEventListener('click', (e) => {
      if (e.target === claimConfirmModal) {
        closeClaimConfirmModal();
      }
    });
  }

  // Return to Home / Registration view from Reward page
  const btnReturnHome = document.getElementById('btnReturnHome');
  if (btnReturnHome) {
    btnReturnHome.addEventListener('click', () => {
      const regView = document.getElementById('registrationView');
      const rewardView = document.getElementById('rewardPageView');
      if (rewardView) rewardView.style.display = 'none';
      if (regView) regView.style.display = 'block';

      // Keep remembered ID in input field so employee can easily see or resubmit
      const savedId = localStorage.getItem('AL_SAVED_EMPLOYEE_ID');
      if (savedId && empIdInput) {
        empIdInput.value = savedId;
        if (btnClear) btnClear.classList.add('is-visible');
      }

      const scrollContainer = document.querySelector('.app-scroll-container');
      if (scrollContainer) scrollContainer.scrollTop = 0;
    });
  }

  // Logout button: clears remembered ID and clears input for a new employee
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      try {
        localStorage.removeItem('AL_SAVED_EMPLOYEE_ID');
      } catch (e) {}

      if (personalDocUnsubscribe) {
        personalDocUnsubscribe();
        personalDocUnsubscribe = null;
      }
      lastRenderedUserSignature = '';
      lastRenderedDrawStateKey = '';
      lastRenderedMedalKey = '';

      currentViewingEmp = null;
      const regView = document.getElementById('registrationView');
      const rewardView = document.getElementById('rewardPageView');
      if (rewardView) rewardView.style.display = 'none';
      if (regView) regView.style.display = 'block';

      if (empIdInput) {
        empIdInput.value = '';
        if (btnClear) btnClear.classList.remove('is-visible');
        empIdInput.focus();
      }

      const scrollContainer = document.querySelector('.app-scroll-container');
      if (scrollContainer) scrollContainer.scrollTop = 0;
    });
  }

  // Auto-check for remembered Employee ID on page load
  function checkAutoLogin() {
    try {
      const savedId = localStorage.getItem('AL_SAVED_EMPLOYEE_ID');
      if (!savedId || String(savedId).trim() === '') return;

      const cleanId = String(savedId).trim();
      if (empIdInput) {
        empIdInput.value = cleanId;
        if (btnClear) btnClear.classList.add('is-visible');
      }

      // If already viewing reward page, do not re-trigger
      const rewardView = document.getElementById('rewardPageView');
      if (rewardView && rewardView.style.display === 'block') return;

      // 1. ตรวจสอบข้อมูลจากแคช SessionStorage เพื่อความเร็วสูงสุดแบบไม่ต้องรอการโหลด
      try {
        const sessionCache = sessionStorage.getItem('AL_CACHED_USER_' + cleanId);
        if (sessionCache) {
          const parsed = JSON.parse(sessionCache);
          if (parsed && hasValidGroup(parsed.Group)) {
            showRewardPage(cleanId, parsed, formatRegisteredDisplayTime(parsed.registeredAt), null, true);
            attachPersonalDocumentListener(cleanId);
            return;
          }
        }
      } catch (e) {}

      // 2. ตรวจสอบจากแคช LocalStorage
      const localList = cachedEmployeeList && cachedEmployeeList.length > 0 ? cachedEmployeeList : getLocalEmployees();
      const found = localList.find(x => String(x.EmployeeID).trim() === cleanId);

      if (found) {
        if (hasValidGroup(found.Group)) {
          showRewardPage(cleanId, found, formatRegisteredDisplayTime(found.registeredAt), null, true);
          attachPersonalDocumentListener(cleanId);
        }
      } else if (db) {
        db.collection(collectionName).doc(cleanId).get().then(docSnap => {
          if (docSnap.exists) {
            const data = docSnap.data();
            if (hasValidGroup(data.Group)) {
              showRewardPage(cleanId, data, formatRegisteredDisplayTime(data.registeredAt), null, true);
              attachPersonalDocumentListener(cleanId);
            }
          }
        }).catch(() => {});
      }
    } catch (e) {}
  }

  checkAutoLogin();
});
