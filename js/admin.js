/**
 * AL Drive Forum Special - Admin Portal Logic
 * Connects to Firebase Firestore collection: AL_Employee
 */

// App State
const state = {
  db: null,
  collectionName: (window.DB_PATHS && window.DB_PATHS.AL_EMPLOYEE) || "AL_Employee",
  rewardsCollection: (window.DB_PATHS && window.DB_PATHS.AL_REWARD) || "AL_Reward",
  employees: [],
  rewards: [],
  isFirebaseConnected: false,
  unsubscribeSnapshot: null,
  unsubscribeRewardsSnapshot: null,
  
  // Filtering & Pagination
  activeTab: "tabRegister",
  searchQuery: "",
  medalSearchQuery: "",
  filterStatus: "ALL",
  filterGroups: ["BBD", "AL", "MDS", "T-Con"],
  filterZone: "ALL",
  filterMember: "ALL",
  filterRewardGroup: "ALL",
  
  // Sorting & Pagination
  sortColumn: "isRegistered",
  sortDirection: "desc",
  currentPage: 1,
  pageSize: 30,
  
  // Charts
  timelineChart: null,
  groupChart: null,

  // Excel Upload Temp Storage
  parsedUploadRows: []
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initTabs();
  initFirebaseService();
  initTableEvents();
  initRewardsManager();
  initLuckyDraw();
  initUploadModal();
  initAddEmployeeModal();
  initResetWinnersModal();
  initResetRegModal();
  initCancelRegModal();
  initDeleteAllEmpModal();
  initDrawButtonSettings();
});

// =============================================================================
// TAB NAVIGATION
// =============================================================================
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      if (state.activeTab === targetTab) return;

      tabBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const activePanel = document.getElementById(targetTab);
      if (activePanel) activePanel.classList.add('active');

      state.activeTab = targetTab;

      // Re-render / resize charts if switching to Register tab
      if (targetTab === 'tabRegister') {
        renderCharts();
      } else if (targetTab === 'tabEmployee') {
        renderEmployeeTable();
      } else if (targetTab === 'tabRewards') {
        renderRewardsView();
      } else if (targetTab === 'tabMedals') {
        renderMedalsView();
      } else if (targetTab === 'tabLuckyDraw') {
        renderLuckyDrawView();
      } else if (targetTab === 'tabWinners') {
        renderWinnersView();
      }
    });
  });
}

window.switchToTab = function(tabName) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (btn) btn.click();
};

// Auto switch tab if URL has hash (e.g. #tabLuckyDraw)
function checkUrlHashTab() {
  if (window.location.hash) {
    const hash = window.location.hash.replace('#', '');
    window.switchToTab(hash);
  }
}
window.addEventListener('hashchange', checkUrlHashTab);
setTimeout(checkUrlHashTab, 100);

// =============================================================================
// FIREBASE SERVICE & REALTIME LISTENER
// =============================================================================
const realtimeChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('AL_REALTIME_SYNC') : null;

function broadcastDataChange() {
  if (realtimeChannel) {
    try {
      realtimeChannel.postMessage({
        type: 'DATABASE_SYNC',
        employees: state.employees
      });
    } catch (e) {}
  }
}

function broadcastRewardsChange() {
  if (realtimeChannel) {
    try {
      realtimeChannel.postMessage({
        type: 'REWARDS_SYNC',
        rewards: state.rewards
      });
    } catch (e) {}
  }
}

function initRealtimeChannelListener() {
  if (realtimeChannel) {
    realtimeChannel.onmessage = (event) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'EMPLOYEE_REGISTERED') {
        const empId = String(msg.employeeId).trim();
        const emp = state.employees.find(e => String(e.EmployeeID).trim() === empId);
        if (emp) {
          emp.isRegistered = true;
          emp.registeredAt = msg.timestamp;
        } else {
          state.employees.unshift({
            EmployeeID: empId,
            EmpName: msg.empName || '-',
            EmpPosition: msg.empPosition || '-',
            EmpBranch: msg.empBranch || '-',
            EmpZone: msg.empZone || '-',
            EmpRH: msg.empRH || 'RH5',
            Group: msg.group || 'BBD',
            Member: msg.member || '',
            isRegistered: true,
            registeredAt: msg.timestamp
          });
        }
        try {
          localStorage.setItem('AL_EMPLOYEES_DATA', JSON.stringify(state.employees));
        } catch (e) {}
        onDataUpdated();
        showToast(`⚡ Real-time: รหัส ${empId} ลงทะเบียนสำเร็จ`, 'success');
      } else if (msg.type === 'MEMBER_MEDAL_CLAIMED') {
        const empId = String(msg.employeeId).trim();
        const emp = state.employees.find(e => String(e.EmployeeID).trim() === empId);
        if (emp) {
          emp.MemberDate = msg.memberDate;
        }
        try {
          localStorage.setItem('AL_EMPLOYEES_DATA', JSON.stringify(state.employees));
        } catch (e) {}
        onDataUpdated();
        showToast(`⚡ Real-time: รหัส ${empId} บันทึกรับเหรียญรางวัลแล้ว`, 'info');
      } else if (msg.type === 'REWARDS_SYNC') {
        if (Array.isArray(msg.rewards)) {
          state.rewards = msg.rewards;
          onRewardsUpdated();
        }
      } else if (msg.type === 'DRAW_BUTTONS_CONFIG' && msg.config) {
        const chkNormal = document.getElementById('chkShowNormalDraw');
        const chkFast = document.getElementById('chkShowFastDraw');
        if (chkNormal) chkNormal.checked = msg.config.showNormal !== false;
        if (chkFast) chkFast.checked = msg.config.showFast !== false;
      }
    };
  }

  window.addEventListener('storage', (e) => {
    if (e.key === 'AL_EMPLOYEES_DATA') {
      const updated = getSavedEmployees();
      if (updated && updated.length > 0) {
        state.employees = updated;
        onDataUpdated();
      }
    } else if (e.key === 'AL_REWARDS_DATA') {
      const updatedRewards = getSavedRewards();
      if (updatedRewards) {
        state.rewards = updatedRewards;
        onRewardsUpdated();
      }
    } else if (e.key === 'AL_DRAW_BUTTON_SETTINGS') {
      try {
        const config = JSON.parse(e.newValue);
        const chkNormal = document.getElementById('chkShowNormalDraw');
        const chkFast = document.getElementById('chkShowFastDraw');
        if (chkNormal && config) chkNormal.checked = config.showNormal !== false;
        if (chkFast && config) chkFast.checked = config.showFast !== false;
      } catch (err) {}
    }
  });
}

// ควบคุมการแสดงปุ่มสุ่มรางวัลใน random.html (สุ่มปกติ / สุ่มเร็ว)
function initDrawButtonSettings() {
  const chkNormal = document.getElementById('chkShowNormalDraw');
  const chkFast = document.getElementById('chkShowFastDraw');
  if (!chkNormal || !chkFast) return;

  let settings = { showNormal: true, showFast: true };
  try {
    const saved = localStorage.getItem('AL_DRAW_BUTTON_SETTINGS');
    if (saved) {
      settings = JSON.parse(saved);
    }
  } catch (e) {}

  chkNormal.checked = settings.showNormal !== false;
  chkFast.checked = settings.showFast !== false;

  function syncConfig() {
    const config = {
      showNormal: chkNormal.checked,
      showFast: chkFast.checked
    };
    try {
      localStorage.setItem('AL_DRAW_BUTTON_SETTINGS', JSON.stringify(config));
    } catch (e) {}

    if (realtimeChannel) {
      try {
        realtimeChannel.postMessage({
          type: 'DRAW_BUTTONS_CONFIG',
          config: config
        });
      } catch (e) {}
    }
  }

  chkNormal.addEventListener('change', syncConfig);
  chkFast.addEventListener('change', syncConfig);

  syncConfig();
}

function initFirebaseService() {
  initRealtimeChannelListener();

  try {
    if (typeof window.initFirebase === 'function') {
      const fb = window.initFirebase();
      if (fb && fb.db) {
        state.db = fb.db;
        listenToFirestore();
        listenToRewardsFirestore();
        return;
      }
    }
  } catch (err) {
    console.warn("Firebase connection error:", err);
  }

  // Fallback to local storage
  loadFromLocalStorage();
  loadRewardsFromLocalStorage();
  updateConnStatusUI(true, "Real-time Live (Local)");
}

function updateConnStatusUI(connected, text) {
  const connStatus = document.getElementById('connStatus');
  if (!connStatus) return;
  const pulse = connStatus.querySelector('.status-pulse');
  const statusText = connStatus.querySelector('.status-text');

  if (connected) {
    pulse.style.background = "#10b981";
    statusText.textContent = text || "Real-time Live";
    state.isFirebaseConnected = true;
  } else {
    pulse.style.background = "#f59e0b";
    statusText.textContent = text || "โหมด Local Cache";
    state.isFirebaseConnected = false;
  }
}

function listenToFirestore() {
  if (!state.db) return;

  if (state.unsubscribeSnapshot) {
    state.unsubscribeSnapshot();
  }

  updateConnStatusUI(true, "กำลังซิงค์ Real-time...");

  state.unsubscribeSnapshot = state.db.collection(state.collectionName)
    .onSnapshot((snapshot) => {
      if (snapshot.empty) {
        console.log(`Firestore collection ${state.collectionName} is empty.`);
        const local = getSavedEmployees();
        state.employees = local || [];
      } else {
        const list = [];
        snapshot.forEach(doc => {
          list.push({ id: doc.id, ...doc.data() });
        });
        state.employees = list;
        saveToLocalStorage(list);
      }

      updateConnStatusUI(true, "Real-time Live (Firestore)");
      onDataUpdated();
      broadcastDataChange();
    }, (error) => {
      console.warn("Firestore onSnapshot error:", error);
      updateConnStatusUI(false, "โหมด Local Cache");
      loadFromLocalStorage();
    });
}

function loadFromLocalStorage() {
  const local = getSavedEmployees();
  state.employees = local || [];
  onDataUpdated();
}

function getSavedEmployees() {
  try {
    const raw = localStorage.getItem('AL_EMPLOYEES_DATA');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveToLocalStorage(data) {
  try {
    localStorage.setItem('AL_EMPLOYEES_DATA', JSON.stringify(data));
    broadcastDataChange();
  } catch (e) {}
}

// Triggered whenever employee data changes
function onDataUpdated() {
  updateBadges();
  updateKPICards();
  populateZoneFilter();
  populateMemberFilter();
  syncGroupFilterOptions();
  renderRegisteredTable();
  renderEmployeeTable();
  renderCharts();
  renderRewardsView();
  renderMedalsView();
  renderLuckyDrawView();
  renderLuckyWinnersTable();
}

function updateBadges() {
  const total = state.employees.length;
  const registered = state.employees.filter(e => e.isRegistered).length;
  const drawnCount = state.employees.filter(e => e.RewardName && e.RewardName !== '-' && String(e.RewardName).trim() !== '').length;
  const eligibleCount = getEligibleCandidates('ALL').length;

  const medalEligible = state.employees.filter(e => e.Member && String(e.Member).trim() !== '' && String(e.Member).trim() !== '-' && String(e.Member).toLowerCase() !== 'null');
  const medalClaimed = medalEligible.filter(e => e.MemberDate && String(e.MemberDate).trim() !== '' && String(e.MemberDate).trim() !== '-' && String(e.MemberDate).toLowerCase() !== 'null').length;

  // คำนวณจำนวนของรางวัลทั้งหมดจากจำนวน quantity ของทุกรางวัลแทนจำนวนรายการแถว
  const totalRewardQty = (state.rewards || []).reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);

  const badgeReg = document.getElementById('badgeRegCount');
  const badgeEmp = document.getElementById('badgeEmpCount');
  const badgeRewards = document.getElementById('badgeRewardsCount');
  const badgeMedals = document.getElementById('badgeMedalsCount');
  const badgeDraw = document.getElementById('badgeDrawCount');
  const badgeWinners = document.getElementById('badgeWinnersCount');

  if (badgeReg) badgeReg.textContent = registered;
  if (badgeEmp) badgeEmp.textContent = total;
  if (badgeRewards) badgeRewards.textContent = totalRewardQty.toLocaleString();
  if (badgeMedals) badgeMedals.textContent = `${medalClaimed}/${medalEligible.length}`;
  if (badgeDraw) badgeDraw.textContent = eligibleCount;
  if (badgeWinners) badgeWinners.textContent = drawnCount;
}

// =============================================================================
// TAB 1: KPI & CHARTS
// =============================================================================
function updateKPICards() {
  const total = state.employees.length;
  const registered = state.employees.filter(e => e.isRegistered).length;
  const unregistered = total - registered;
  const rate = total > 0 ? ((registered / total) * 100).toFixed(1) : 0;
  const pendingRate = total > 0 ? ((unregistered / total) * 100).toFixed(1) : 0;

  document.getElementById('kpiTotalEmployees').textContent = total.toLocaleString();
  document.getElementById('kpiRegisteredCount').textContent = registered.toLocaleString();
  document.getElementById('kpiUnregisteredCount').textContent = unregistered.toLocaleString();
  document.getElementById('kpiRatePercent').textContent = `${rate}%`;

  const timelinePill = document.getElementById('timelineRegisteredPill');
  if (timelinePill) {
    timelinePill.textContent = `ลงทะเบียนแล้ว ${registered.toLocaleString()} คน (${rate}%)`;
  }

  const bar = document.getElementById('regProgressBar');
  if (bar) bar.style.width = `${rate}%`;

  const hint = document.getElementById('kpiPendingPercent');
  if (hint) hint.textContent = `${pendingRate}% ยังไม่ลงทะเบียน`;

  // Calculate Peak Hour
  const hourCounts = {};
  state.employees.filter(e => e.isRegistered && e.registeredAt).forEach(e => {
    let hour = null;
    const str = String(e.registeredAt).trim();
    const match = str.match(/(?:^|\s|T)(\d{1,2}):\d{2}/);
    if (match) {
      hour = String(match[1]).padStart(2, '0');
    }
    if (hour) {
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }
  });

  let peakHour = "-";
  let maxCount = 0;
  for (const [h, count] of Object.entries(hourCounts)) {
    if (count > maxCount) {
      maxCount = count;
      peakHour = `${h}:00 - ${h}:59 น. (${count} คน)`;
    }
  }
  const peakElem = document.getElementById('kpiPeakHour');
  if (peakElem) peakElem.textContent = `ช่วงเวลาหนาแน่น: ${peakHour}`;
}

function renderCharts() {
  renderTimelineChart();
  renderGroupChart();
}

function renderTimelineChart() {
  const canvas = document.getElementById('timelineChart');
  if (!canvas) return;

  // 24-hour cycle: 00:00 to 23:00
  const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
  const hourlyCounts = {};
  for (let i = 0; i < 24; i++) {
    hourlyCounts[String(i).padStart(2, '0')] = 0;
  }

  state.employees.filter(e => e.isRegistered && e.registeredAt).forEach(e => {
    let hour = null;
    const str = String(e.registeredAt).trim();
    const match = str.match(/(?:^|\s|T)(\d{1,2}):\d{2}/);
    if (match) {
      hour = String(match[1]).padStart(2, '0');
    }
    if (hour && hourlyCounts[hour] !== undefined) {
      hourlyCounts[hour]++;
    } else {
      hourlyCounts['09'] = (hourlyCounts['09'] || 0) + 1;
    }
  });

  const hourlyData = hours.map(h => hourlyCounts[h.split(':')[0]] || 0);

  // Cumulative data
  let accum = 0;
  const cumulativeData = hourlyData.map(v => {
    accum += v;
    return accum;
  });

  if (state.timelineChart) {
    state.timelineChart.destroy();
  }

  const isDark = document.body.classList.contains('dark-mode');
  const textColor = isDark ? '#cbd5e1' : '#334155';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, 'rgba(18, 85, 234, 0.35)');
  gradient.addColorStop(1, 'rgba(18, 85, 234, 0.0)');

  state.timelineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: hours,
      datasets: [
        {
          label: 'ผู้ลงทะเบียนสะสม (Cumulative)',
          data: cumulativeData,
          borderColor: '#1255ea',
          backgroundColor: gradient,
          borderWidth: 2.5,
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: '#1255ea',
          yAxisID: 'y'
        },
        {
          label: 'จำนวนลงทะเบียนรายชั่วโมง',
          data: hourlyData,
          type: 'bar',
          backgroundColor: 'rgba(255, 107, 0, 0.75)',
          borderRadius: 4,
          maxBarThickness: 14,
          yAxisID: 'y'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { color: textColor, font: { family: 'Kanit', size: 12 } }
        },
        tooltip: {
          titleFont: { family: 'Kanit' },
          bodyFont: { family: 'Kanit' },
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const h = items[0].label;
              const nextH = String((parseInt(h, 10) + 1) % 24).padStart(2, '0') + ':00';
              return `ช่วงเวลา ${h} - ${nextH} น.`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: textColor,
            font: { family: 'Kanit', size: 10 },
            maxRotation: 0,
            autoSkip: false
          }
        },
        y: {
          beginAtZero: true,
          ticks: { color: textColor, stepSize: 2, font: { family: 'Kanit' } },
          grid: { color: gridColor }
        }
      }
    }
  });
}

function renderGroupChart() {
  const canvas = document.getElementById('groupChart');
  if (!canvas) return;

  const groups = ['BBD', 'AL', 'MDS', 'T-Con', 'Guest'];
  const registeredCounts = [0, 0, 0, 0, 0];
  const unregisteredCounts = [0, 0, 0, 0, 0];

  const isGuestEmp = (e) => {
    const name = e.EmpName;
    return !name || name === '-' || String(name).trim() === '' || String(name).trim().toLowerCase() === 'null';
  };

  state.employees.forEach(e => {
    if (isGuestEmp(e)) {
      const guestIdx = groups.indexOf('Guest');
      if (e.isRegistered) {
        registeredCounts[guestIdx]++;
      } else {
        unregisteredCounts[guestIdx]++;
      }
    } else {
      const idx = groups.indexOf(e.Group);
      if (idx !== -1) {
        if (e.isRegistered) {
          registeredCounts[idx]++;
        } else {
          unregisteredCounts[idx]++;
        }
      }
    }
  });

  if (state.groupChart) {
    state.groupChart.destroy();
  }

  const isDark = document.body.classList.contains('dark-mode');
  const textColor = isDark ? '#cbd5e1' : '#334155';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
  const unregBg = isDark ? '#475569' : '#cbd5e1';

  // Custom Plugin: แสดงจำนวนในกราฟแท่ง และแสดง % สัดส่วนการลงทะเบียนเหนือกราฟแท่งแต่ละแท่ง
  const groupBarLabelsPlugin = {
    id: 'groupBarLabelsPlugin',
    afterDatasetsDraw(chart) {
      const { ctx, data } = chart;
      const meta0 = chart.getDatasetMeta(0);
      const meta1 = chart.getDatasetMeta(1);
      if (!meta0 || !meta0.data || !meta0.data.length) return;

      ctx.save();
      const currentDark = document.body.classList.contains('dark-mode');
      const numBars = data.labels.length;

      for (let i = 0; i < numBars; i++) {
        const regVal = data.datasets[0].data[i] || 0;
        const unregVal = data.datasets[1].data[i] || 0;
        const total = regVal + unregVal;

        // 1. Text inside the bars (จำนวนในกราฟแท่ง)
        ctx.font = '600 12px Kanit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Inside registered bar (green)
        if (regVal > 0 && meta0.data[i]) {
          const bar0 = meta0.data[i];
          const barH0 = Math.abs(bar0.base - bar0.y);
          if (barH0 >= 14) {
            ctx.fillStyle = '#ffffff';
            ctx.fillText(regVal.toLocaleString(), bar0.x, (bar0.base + bar0.y) / 2);
          }
        }

        // Inside unregistered bar (gray)
        if (unregVal > 0 && meta1 && meta1.data[i]) {
          const bar1 = meta1.data[i];
          const barH1 = Math.abs(bar1.base - bar1.y);
          if (barH1 >= 14) {
            ctx.fillStyle = currentDark ? '#ffffff' : '#1e293b';
            ctx.fillText(unregVal.toLocaleString(), bar1.x, (bar1.base + bar1.y) / 2);
          }
        }

        // 2. Text above the bar (เหนือกราฟแท่งแสดง % สัดส่วนการลงทะเบียนของแท่งกราฟแต่ละแท่ง)
        let topY = null;
        let barX = null;
        if (unregVal > 0 && meta1 && meta1.data[i]) {
          topY = meta1.data[i].y;
          barX = meta1.data[i].x;
        } else if (regVal > 0 && meta0.data[i]) {
          topY = meta0.data[i].y;
          barX = meta0.data[i].x;
        } else if (meta0.data[i]) {
          topY = meta0.data[i].base;
          barX = meta0.data[i].x;
        }

        if (topY !== null && barX !== null) {
          const pct = total > 0 ? ((regVal / total) * 100).toFixed(1) : 0;
          ctx.font = '700 12px Kanit, sans-serif';
          ctx.fillStyle = currentDark ? '#38bdf8' : '#0284c7';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`${pct}%`, barX, topY - 4);
        }
      }
      ctx.restore();
    }
  };

  const ctx = canvas.getContext('2d');
  state.groupChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: groups,
      datasets: [
        {
          label: 'ลงทะเบียนแล้ว',
          data: registeredCounts,
          backgroundColor: '#10b981',
          borderRadius: 6
        },
        {
          label: 'ยังไม่ลงทะเบียน',
          data: unregisteredCounts,
          backgroundColor: unregBg,
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: textColor, font: { family: 'Kanit' } }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grace: '15%',
          ticks: { color: textColor, stepSize: 2, font: { family: 'Kanit' } },
          grid: { color: gridColor }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: textColor, font: { family: 'Kanit', size: 12 } }
        }
      }
    },
    plugins: [groupBarLabelsPlugin]
  });
}

function renderRegisteredTable() {
  const tbody = document.getElementById('registeredTableBody');
  if (!tbody) return;

  const registered = state.employees
    .filter(e => e.isRegistered)
    .sort((a, b) => (b.registeredAt || '').localeCompare(a.registeredAt || ''));

  if (registered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" class="td-empty">ยังไม่มีผู้ลงทะเบียนในขณะนี้</td></tr>`;
    return;
  }

  tbody.innerHTML = registered.map((emp, idx) => {
    const isGuest = !emp.EmpName || emp.EmpName === '-' || String(emp.EmpName).trim() === '' || String(emp.EmpName).trim().toLowerCase() === 'null';
    const actionHtml = isGuest
      ? `<button type="button" class="btn-cancel-reg" title="ยกเลิกการลงทะเบียน / ลบรายการ" onclick="openCancelRegModal('${escapeHtml(String(emp.EmployeeID || ''))}')">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="8.5" cy="7" r="4"></circle>
            <line x1="18" y1="8" x2="23" y2="13"></line>
            <line x1="23" y1="8" x2="18" y2="13"></line>
          </svg>
        </button>`
      : `<span style="color: var(--color-text-muted);">-</span>`;

    return `
      <tr>
        <td>${idx + 1}</td>
        <td class="td-time">${emp.registeredAt || '-'}</td>
        <td><span class="badge-id">${emp.EmployeeID}</span></td>
        <td>${emp.EmpName || '<span class="badge-group badge-group-default">Guest</span>'}</td>
        <td>${emp.EmpPosition || '-'}</td>
        <td>${emp.EmpBranch || '-'}</td>
        <td>${emp.EmpZone || '-'}</td>
        <td><span class="badge-group badge-group-${emp.Group || 'default'}">${emp.Group || '-'}</span></td>
        <td>${emp.Member ? `<span class="badge-member">${escapeHtml(emp.Member)}</span>` : '-'}</td>
        <td style="text-align: center;">
          <span class="status-badge registered"><span class="dot"></span> ลงทะเบียนแล้ว</span>
        </td>
        <td style="text-align: center;">
          ${actionHtml}
        </td>
      </tr>
    `;
  }).join('');
}

// =============================================================================
// TAB 2: EMPLOYEE TABLE & FILTERING & PAGINATION
// =============================================================================

// Multi-Select Group Dropdown with Checkboxes
function initGroupDropdown() {
  const dropdown = document.getElementById('dropdownGroup');
  const btn = document.getElementById('dropdownGroupBtn');
  const chkAll = document.getElementById('chkGroupAll');
  if (!dropdown || !btn || !chkAll) return;

  // Toggle dropdown on button click
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  // Close when clicking anywhere outside
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) {
      dropdown.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });

  // "ทุกกลุ่ม" Checkbox (Select all / Deselect all)
  chkAll.addEventListener('change', () => {
    const isChecked = chkAll.checked;
    const items = dropdown.querySelectorAll('.chk-group-item');
    items.forEach(chk => {
      chk.checked = isChecked;
    });
    updateGroupFilterState(true);
  });

  // Individual group checkbox changes
  dropdown.addEventListener('change', (e) => {
    if (e.target && e.target.classList.contains('chk-group-item')) {
      updateGroupFilterState(true);
    }
  });
}

function updateGroupFilterState(triggerRender = true) {
  const dropdown = document.getElementById('dropdownGroup');
  const label = document.getElementById('dropdownGroupLabel');
  const chkAll = document.getElementById('chkGroupAll');
  if (!dropdown || !label || !chkAll) return;

  const items = Array.from(dropdown.querySelectorAll('.chk-group-item'));
  const checkedValues = items.filter(chk => chk.checked).map(chk => chk.value);

  state.filterGroups = checkedValues;

  if (checkedValues.length === items.length && items.length > 0) {
    chkAll.checked = true;
    chkAll.indeterminate = false;
    label.textContent = 'ทุกกลุ่ม';
  } else if (checkedValues.length === 0) {
    chkAll.checked = false;
    chkAll.indeterminate = false;
    label.textContent = 'ไม่ได้เลือกกลุ่ม';
  } else {
    chkAll.checked = false;
    chkAll.indeterminate = true;
    label.textContent = checkedValues.join(', ');
  }

  if (triggerRender) {
    state.currentPage = 1;
    renderEmployeeTable();
  }
}

function resetGroupFilter() {
  const dropdown = document.getElementById('dropdownGroup');
  const label = document.getElementById('dropdownGroupLabel');
  const chkAll = document.getElementById('chkGroupAll');
  if (!dropdown || !label || !chkAll) return;

  chkAll.checked = true;
  chkAll.indeterminate = false;
  const items = dropdown.querySelectorAll('.chk-group-item');
  items.forEach(chk => {
    chk.checked = true;
  });

  state.filterGroups = Array.from(items).map(chk => chk.value);
  label.textContent = 'ทุกกลุ่ม';
}

function syncGroupFilterOptions() {
  const container = document.getElementById('groupCheckboxList');
  if (!container) return;

  const standardGroups = ['BBD', 'AL', 'MDS', 'T-Con'];
  const employeeGroups = [...new Set(state.employees.map(e => e.Group).filter(g => g && g !== '-'))];
  const allGroups = [...new Set([...standardGroups, ...employeeGroups])];

  // Capture currently selected
  const currentlyChecked = new Set(state.filterGroups || []);
  const isFirstRun = !state.filterGroups || state.filterGroups.length === 0;

  let html = '';
  allGroups.forEach(group => {
    const isChecked = isFirstRun || currentlyChecked.has(group);
    html += `
      <label class="dropdown-item">
        <input type="checkbox" class="chk-group-item" value="${group}" ${isChecked ? 'checked' : ''}>
        <span class="chk-box"></span>
        <span class="item-text badge-group badge-group-${group}">${group}</span>
      </label>
    `;
  });
  container.innerHTML = html;

  updateGroupFilterState(false);
}

function initTableEvents() {
  const searchInput = document.getElementById('empSearchInput');
  const btnClearSearch = document.getElementById('btnClearSearch');
  const filterStatus = document.getElementById('filterStatus');
  const filterZone = document.getElementById('filterZone');
  const filterMember = document.getElementById('filterMember');
  const btnReset = document.getElementById('btnResetFilters');
  const pageSizeSelect = document.getElementById('pageSizeSelect');

  // Initialize Custom Multi-select Dropdown
  initGroupDropdown();

  // Search Input
  searchInput.addEventListener('input', () => {
    state.searchQuery = searchInput.value.trim().toLowerCase();
    btnClearSearch.style.display = state.searchQuery ? 'block' : 'none';
    state.currentPage = 1;
    renderEmployeeTable();
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    btnClearSearch.style.display = 'none';
    state.currentPage = 1;
    renderEmployeeTable();
  });

  // Filters
  filterStatus.addEventListener('change', () => {
    state.filterStatus = filterStatus.value;
    state.currentPage = 1;
    renderEmployeeTable();
  });

  filterZone.addEventListener('change', () => {
    state.filterZone = filterZone.value;
    state.currentPage = 1;
    renderEmployeeTable();
  });

  if (filterMember) {
    filterMember.addEventListener('change', () => {
      state.filterMember = filterMember.value;
      state.currentPage = 1;
      renderEmployeeTable();
    });
  }

  btnReset.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    btnClearSearch.style.display = 'none';
    filterStatus.value = 'ALL';
    state.filterStatus = 'ALL';
    resetGroupFilter();
    filterZone.value = 'ALL';
    state.filterZone = 'ALL';
    if (filterMember) {
      filterMember.value = 'ALL';
    }
    state.filterMember = 'ALL';
    state.currentPage = 1;
    renderEmployeeTable();
  });

  // Page Size
  pageSizeSelect.addEventListener('change', () => {
    state.pageSize = parseInt(pageSizeSelect.value, 10);
    state.currentPage = 1;
    renderEmployeeTable();
  });

  // Pagination Buttons
  document.getElementById('btnFirstPage').addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage = 1;
      renderEmployeeTable();
    }
  });

  document.getElementById('btnPrevPage').addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderEmployeeTable();
    }
  });

  document.getElementById('btnNextPage').addEventListener('click', () => {
    const filtered = getFilteredEmployees();
    const totalPages = Math.ceil(filtered.length / state.pageSize) || 1;
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderEmployeeTable();
    }
  });

  document.getElementById('btnLastPage').addEventListener('click', () => {
    const filtered = getFilteredEmployees();
    const totalPages = Math.ceil(filtered.length / state.pageSize) || 1;
    if (state.currentPage < totalPages) {
      state.currentPage = totalPages;
      renderEmployeeTable();
    }
  });

  // Export Buttons
  document.getElementById('btnExportRegistered').addEventListener('click', exportRegisteredExcel);
  document.getElementById('btnExportAllEmp').addEventListener('click', exportAllEmployeesExcel);
  const btnExportMedals = document.getElementById('btnExportMedalsExcel');
  if (btnExportMedals) {
    btnExportMedals.addEventListener('click', exportMedalsExcel);
  }

  // Medal Search Input
  const medalSearchInput = document.getElementById('medalSearchInput');
  const btnClearMedalSearch = document.getElementById('btnClearMedalSearch');
  if (medalSearchInput) {
    medalSearchInput.addEventListener('input', (e) => {
      state.medalSearchQuery = e.target.value.trim().toLowerCase();
      if (btnClearMedalSearch) {
        btnClearMedalSearch.style.display = state.medalSearchQuery ? 'block' : 'none';
      }
      renderMedalsView();
    });
  }
  if (btnClearMedalSearch) {
    btnClearMedalSearch.addEventListener('click', () => {
      if (medalSearchInput) medalSearchInput.value = '';
      state.medalSearchQuery = '';
      btnClearMedalSearch.style.display = 'none';
      renderMedalsView();
    });
  }

  // Close medal action buttons when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.medal-emp-box')) {
      document.querySelectorAll('.medal-emp-box.has-action-visible').forEach(box => {
        box.classList.remove('has-action-visible');
      });
    }
  });

  // Table Header Column Sorting
  document.querySelectorAll('.sortable-th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (!key) return;

      if (state.sortColumn === key) {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortColumn = key;
        state.sortDirection = 'asc';
      }
      renderEmployeeTable();
    });
  });
}

function updateSortIndicators() {
  document.querySelectorAll('.sortable-th').forEach(th => {
    const key = th.dataset.sortKey;
    th.classList.remove('sort-asc', 'sort-desc');
    if (key === state.sortColumn) {
      th.classList.add(state.sortDirection === 'desc' ? 'sort-desc' : 'sort-asc');
    }
  });
}

function populateZoneFilter() {
  const filterZone = document.getElementById('filterZone');
  if (!filterZone) return;

  const current = filterZone.value;
  const zones = [...new Set(state.employees.map(e => e.EmpZone).filter(Boolean))].sort();

  let html = `<option value="ALL">ทุกโซน</option>`;
  zones.forEach(z => {
    html += `<option value="${z}" ${z === current ? 'selected' : ''}>${z}</option>`;
  });
  filterZone.innerHTML = html;
}

function populateMemberFilter() {
  const filterMember = document.getElementById('filterMember');
  if (!filterMember) return;

  const current = filterMember.value;
  const members = [...new Set(state.employees.map(e => e.Member).filter(Boolean))].sort();

  let html = `<option value="ALL">ทุก Member</option>`;
  members.forEach(m => {
    html += `<option value="${m}" ${m === current ? 'selected' : ''}>${m}</option>`;
  });
  filterMember.innerHTML = html;
}

function getFilteredEmployees() {
  const filtered = state.employees.filter(emp => {
    // Search query
    if (state.searchQuery) {
      const q = state.searchQuery;
      const match = (emp.EmployeeID || '').toLowerCase().includes(q) ||
                    (emp.EmpName || '').toLowerCase().includes(q) ||
                    (emp.EmpPosition || '').toLowerCase().includes(q) ||
                    (emp.EmpBranch || '').toLowerCase().includes(q) ||
                    (emp.EmpZone || '').toLowerCase().includes(q) ||
                    (emp.Group || '').toLowerCase().includes(q) ||
                    (emp.Member || '').toLowerCase().includes(q);
      if (!match) return false;
    }

    // Status filter
    if (state.filterStatus === 'REGISTERED' && !emp.isRegistered) return false;
    if (state.filterStatus === 'UNREGISTERED' && emp.isRegistered) return false;

    // Group filter (multi-select checkboxes)
    if (state.filterGroups && Array.isArray(state.filterGroups)) {
      const allItemCheckboxes = document.querySelectorAll('.chk-group-item');
      const totalAvailable = allItemCheckboxes.length || 4;
      if (state.filterGroups.length === 0) {
        return false;
      }
      if (state.filterGroups.length < totalAvailable) {
        if (!state.filterGroups.includes(emp.Group)) {
          return false;
        }
      }
    }

    // Zone filter
    if (state.filterZone !== 'ALL' && emp.EmpZone !== state.filterZone) return false;

    // Member filter
    if (state.filterMember && state.filterMember !== 'ALL' && emp.Member !== state.filterMember) return false;

    return true;
  });

  // Column Sorting: "เรียงข้อมูลตามการลงทะเบียนแล้ว ตามเวลาล่าสุดที่ลงทะเบียน"
  filtered.sort((a, b) => {
    // If user clicked a specific column header other than registration status (e.g. EmployeeID, EmpName, etc.)
    if (state.sortColumn && state.sortColumn !== 'isRegistered' && state.sortColumn !== 'registeredAt') {
      const col = state.sortColumn;
      const dir = state.sortDirection === 'desc' ? -1 : 1;
      let valA = a[col];
      let valB = b[col];

      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      if (typeof valA === 'boolean' || typeof valB === 'boolean') {
        return (Number(valA) - Number(valB)) * dir;
      }

      const numA = Number(valA);
      const numB = Number(valB);
      if (!isNaN(numA) && !isNaN(numB) && String(valA).trim() !== '' && String(valB).trim() !== '') {
        return (numA - numB) * dir;
      }

      return String(valA).localeCompare(String(valB), 'th', { numeric: true, sensitivity: 'base' }) * dir;
    }

    // Default / "เรียงข้อมูลตามการลงทะเบียนแล้ว ตามเวลาล่าสุดที่ลงทะเบียน":
    // 1. ลงทะเบียนแล้วขึ้นก่อน (isRegistered === true first)
    const regA = a.isRegistered ? 1 : 0;
    const regB = b.isRegistered ? 1 : 0;
    if (regA !== regB) {
      return regB - regA; // 1 before 0
    }

    // 2. สำหรับผู้ลงทะเบียนแล้ว เรียงตามเวลาล่าสุดที่ลงทะเบียน (registeredAt descending)
    if (a.isRegistered && b.isRegistered) {
      const timeA = String(a.registeredAt || a.timestamp || '');
      const timeB = String(b.registeredAt || b.timestamp || '');
      if (timeA !== timeB) {
        return timeB.localeCompare(timeA); // newest/latest first
      }
    }

    // 3. ผู้ยังไม่ลงทะเบียน เรียงตาม EmployeeID
    const numA = Number(a.EmployeeID);
    const numB = Number(b.EmployeeID);
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    return String(a.EmployeeID || '').localeCompare(String(b.EmployeeID || ''), 'th', { numeric: true });
  });

  return filtered;
}

function renderEmployeeTable() {
  const tbody = document.getElementById('empTableBody');
  if (!tbody) return;

  updateSortIndicators();

  const filtered = getFilteredEmployees();
  const total = filtered.length;
  const totalPages = Math.ceil(total / state.pageSize) || 1;

  if (state.currentPage > totalPages) {
    state.currentPage = totalPages;
  }

  const startIdx = (state.currentPage - 1) * state.pageSize;
  const endIdx = Math.min(startIdx + state.pageSize, total);
  const pageRows = filtered.slice(startIdx, endIdx);

  // Update entries info
  const infoElem = document.getElementById('entriesInfo');
  if (infoElem) {
    if (total === 0) {
      infoElem.textContent = "ไม่พบรายการข้อมูล";
    } else {
      infoElem.textContent = `แสดง ${startIdx + 1} ถึง ${endIdx} จากทั้งหมด ${total.toLocaleString()} รายการ`;
    }
  }

  // Update pagination buttons
  updatePaginationControls(totalPages);

  // Render Rows
  if (pageRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" class="td-empty">ไม่พบข้อมูลตามเงื่อนไขการค้นหา</td></tr>`;
    return;
  }

  tbody.innerHTML = pageRows.map((emp, i) => {
    const rowNum = startIdx + i + 1;
    const isReg = !!emp.isRegistered;
    const statusTag = isReg
      ? `<span class="status-badge registered" title="${emp.registeredAt || ''}"><span class="dot"></span> ลงทะเบียนแล้ว</span>`
      : `<span class="status-badge unregistered"><span class="dot"></span> ยังไม่ลงทะเบียน</span>`;

    const canDelete = isEmpNameDeletable(emp.EmpName);
    const rewardBadge = (emp.RewardName && emp.RewardName !== '-' && String(emp.RewardName).trim() !== '')
      ? `<div class="badge-won-prize" title="ได้รับรางวัล: ${emp.RewardName} (${emp.RewardStatus || 'ยังไม่ได้รับ'})">🎁 ${emp.RewardName}</div>`
      : '';

    const deleteBtn = canDelete
      ? `<button type="button" class="btn-icon-sm btn-delete" onclick="deleteEmployee('${emp.EmployeeID}')" title="ลบข้อมูล (ชื่อพนักงานว่างหรือเป็น -)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>`
      : `<button type="button" class="btn-icon-sm btn-delete is-disabled" disabled title="ไม่อนุญาตให้ลบ (ลบได้เฉพาะรายการที่ชื่อพนักงานเป็น '-' หรือค่าว่างเท่านั้น)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>`;

    return `
      <tr>
        <td>${rowNum}</td>
        <td><span class="badge-id">${emp.EmployeeID}</span></td>
        <td>
          ${emp.EmpName || '-'}
          ${rewardBadge}
        </td>
        <td>${emp.EmpPosition || '-'}</td>
        <td>${emp.EmpBranch || '-'}</td>
        <td>${emp.EmpZone || '-'}</td>
        <td>${emp.EmpRH || '-'}</td>
        <td><span class="badge-group badge-group-${emp.Group || 'default'}">${emp.Group || '-'}</span></td>
        <td>${emp.Member ? `<span class="badge-member">${escapeHtml(emp.Member)}</span>` : '-'}</td>
        <td style="text-align: center;">${statusTag}</td>
        <td style="text-align: center;">
          <div class="table-actions">
            <button type="button" class="btn-icon-sm btn-checkin" onclick="toggleRegistration('${emp.EmployeeID}')" title="${isReg ? 'ยกเลิกลงทะเบียน' : 'เช็กอินลงทะเบียน'}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </button>
            ${deleteBtn}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function updatePaginationControls(totalPages) {
  const btnFirst = document.getElementById('btnFirstPage');
  const btnPrev = document.getElementById('btnPrevPage');
  const btnNext = document.getElementById('btnNextPage');
  const btnLast = document.getElementById('btnLastPage');
  const numbersContainer = document.getElementById('pageNumbers');

  btnFirst.disabled = state.currentPage <= 1;
  btnPrev.disabled = state.currentPage <= 1;
  btnNext.disabled = state.currentPage >= totalPages;
  btnLast.disabled = state.currentPage >= totalPages;

  // Generate page numbers (max 5 visible)
  let pages = [];
  const current = state.currentPage;
  const start = Math.max(1, current - 2);
  const end = Math.min(totalPages, start + 4);

  for (let p = start; p <= end; p++) {
    pages.push(p);
  }

  numbersContainer.innerHTML = pages.map(p => `
    <button type="button" class="page-num ${p === current ? 'active' : ''}" onclick="goToPage(${p})">
      ${p}
    </button>
  `).join('');
}

window.goToPage = function(page) {
  state.currentPage = page;
  renderEmployeeTable();
};

// Toggle manual check-in
window.toggleRegistration = function(empId) {
  const strId = String(empId).trim();
  const target = state.employees.find(e => String(e.EmployeeID).trim() === strId || String(e.id || '').trim() === strId);
  if (!target) return;

  const newStatus = !target.isRegistered;
  const now = new Date();
  const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const formattedTime = `${now.getFullYear() + 543}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  // Immediate local update so UI responds instantly
  target.isRegistered = newStatus;
  target.registeredAt = newStatus ? formattedTime : null;
  saveToLocalStorage(state.employees);
  onDataUpdated();
  showToast(`${newStatus ? 'ลงทะเบียน' : 'ยกเลิกลงทะเบียน'} รหัส ${strId} สำเร็จ`, "success");

  // Sync to Firestore in background
  if (state.db) {
    const docId = target.id || strId;
    state.db.collection(state.collectionName).doc(docId).set({
      isRegistered: newStatus,
      registeredAt: newStatus ? formattedTime : null
    }, { merge: true }).catch(err => {
      console.warn("Firestore checkin sync error:", err);
    });
  }
};

function isEmpNameDeletable(empName) {
  if (empName === undefined || empName === null) return true;
  const s = String(empName).trim();
  return s === '' || s === '-' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined';
}

window.deleteEmployee = function(empId) {
  const strId = String(empId).trim();
  const target = state.employees.find(e => String(e.EmployeeID).trim() === strId || String(e.id || '').trim() === strId);
  if (!target) return;

  const canDelete = isEmpNameDeletable(target.EmpName);
  if (!canDelete) {
    showToast(`ไม่อนุญาตให้ลบข้อมูล: ฟิลด์ชื่อพนักงาน (EmpName) ต้องเป็น '-' หรือค่าว่างเท่านั้น`, 'error');
    return;
  }

  if (!confirm(`ต้องการลบข้อมูลพนักงานรหัส ${strId} หรือไม่?`)) return;

  const docId = (target && target.id) ? target.id : strId;

  // Immediately remove from local array
  state.employees = state.employees.filter(e => String(e.EmployeeID).trim() !== strId && String(e.id || '').trim() !== strId);
  saveToLocalStorage(state.employees);
  onDataUpdated();
  showToast(`ลบข้อมูลรหัส ${strId} เรียบร้อยแล้ว`, "success");

  // Sync delete to Firestore in background
  if (state.db) {
    state.db.collection(state.collectionName).doc(docId).delete()
      .then(() => {
        console.log(`Deleted doc ${docId} from Firestore`);
      })
      .catch(err => {
        console.warn("Firestore delete warning:", err);
      });
  }
};

// =============================================================================
// THEME TOGGLE (LIGHT / DARK MODE)
// =============================================================================
function initThemeToggle() {
  const btnToggle = document.getElementById('btnThemeToggle');
  if (!btnToggle) return;

  const sunIcon = btnToggle.querySelector('.icon-sun');
  const moonIcon = btnToggle.querySelector('.icon-moon');
  const themeText = btnToggle.querySelector('.theme-text');

  // Load saved theme
  const savedTheme = localStorage.getItem('ADMIN_THEME') || 'light';
  applyTheme(savedTheme);

  btnToggle.addEventListener('click', () => {
    const isDark = document.body.classList.contains('dark-mode');
    const newTheme = isDark ? 'light' : 'dark';
    applyTheme(newTheme);
    localStorage.setItem('ADMIN_THEME', newTheme);
  });

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.body.classList.add('dark-mode');
      if (sunIcon) sunIcon.style.display = 'none';
      if (moonIcon) moonIcon.style.display = 'block';
      if (themeText) themeText.textContent = 'โหมดสว่าง';
    } else {
      document.body.classList.remove('dark-mode');
      if (sunIcon) sunIcon.style.display = 'block';
      if (moonIcon) moonIcon.style.display = 'none';
      if (themeText) themeText.textContent = 'โหมดมืด';
    }
    // Re-render charts with appropriate theme colors
    renderCharts();
  }
}

// =============================================================================
// EXCEL IMPORT MODAL & LOGIC (SheetJS)
// =============================================================================
function initUploadModal() {
  const modal = document.getElementById('modalUploadExcel');
  const btnOpen = document.getElementById('btnOpenUploadModal');
  const btnClose = document.getElementById('btnCloseUploadModal');
  const btnCancel = document.getElementById('btnCancelUpload');
  const dropzone = document.getElementById('excelDropzone');
  const fileInput = document.getElementById('excelFileInput');
  const btnBrowse = document.getElementById('btnBrowseFile');
  const btnConfirm = document.getElementById('btnConfirmUpload');
  const btnDownloadTemplate = document.getElementById('btnDownloadTemplate');

  btnOpen.addEventListener('click', () => {
    resetUploadModal();
    modal.classList.add('is-active');
    document.body.style.overflow = 'hidden';
  });

  const closeUpload = () => {
    modal.classList.remove('is-active');
    document.body.style.overflow = '';
  };

  btnClose.addEventListener('click', closeUpload);
  btnCancel.addEventListener('click', closeUpload);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeUpload();
  });

  btnBrowse.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processExcelFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      processExcelFile(e.target.files[0]);
    }
  });

  btnConfirm.addEventListener('click', uploadParsedDataToDatabase);
  btnDownloadTemplate.addEventListener('click', downloadTemplateExcel);
}

function resetUploadModal() {
  state.parsedUploadRows = [];
  document.getElementById('uploadPreviewArea').style.display = 'none';
  document.getElementById('uploadProgressWrap').style.display = 'none';
  document.getElementById('btnConfirmUpload').disabled = true;
  document.getElementById('excelFileInput').value = '';
}

function processExcelFile(file) {
  if (typeof XLSX === 'undefined') {
    showToast("ไม่พบโมดูล XLSX สำหรับอ่านไฟล์ Excel", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

      if (!rawRows || rawRows.length === 0) {
        showToast("ไม่พบข้อมูลในไฟล์ Excel ที่เลือก", "error");
        return;
      }

      // Map rows to standard schema
      const mapped = rawRows.map(row => {
        return {
          EmployeeID: String(row.EmployeeID || row['รหัสพนักงาน'] || row.employee_id || row.EmpID || '').trim(),
          EmpName: String(row.EmpName || row['ชื่อพนักงาน'] || row['ชื่อ - นามสกุล'] || row['ชื่อ-สกุล'] || row.Name || '').trim(),
          EmpPosition: String(row.EmpPosition || row['ตำแหน่ง'] || row.Position || '').trim(),
          EmpBranch: String(row.EmpBranch || row['สาขา'] || row.Branch || '').trim(),
          EmpZone: String(row.EmpZone || row['โซน'] || row['พื้นที่'] || row.Zone || '').trim(),
          EmpRH: String(row.EmpRH || row.RH || row['เขต'] || '').trim(),
          Group: String(row.Group || row['กลุ่ม'] || row['สายงาน'] || '').trim(),
          Member: String(row.Member || row.member || row['สมาชิก'] || row['ปี'] || row['ปี Member'] || '').trim(),
          MemberDate: String(row.MemberDate || row.memberDate || row['วันที่รับเหรียญ'] || row['เวลารับเหรียญ'] || '').trim() || null,
          isRegistered: false,
          registeredAt: null
        };
      }).filter(r => r.EmployeeID !== '');

      if (mapped.length === 0) {
        showToast("ไฟล์ไม่มีคอลัมน์ EmployeeID หรือรหัสพนักงาน", "error");
        return;
      }

      state.parsedUploadRows = mapped;
      showUploadPreview(mapped, file.name);
    } catch (err) {
      console.error("Error reading excel:", err);
      showToast("เกิดข้อผิดพลาดในการอ่านไฟล์ Excel: " + err.message, "error");
    }
  };
  reader.readAsArrayBuffer(file);
}

function showUploadPreview(rows, fileName) {
  const previewArea = document.getElementById('uploadPreviewArea');
  const infoElem = document.getElementById('previewFileInfo');
  const tbody = document.getElementById('previewTableBody');
  const btnConfirm = document.getElementById('btnConfirmUpload');

  infoElem.textContent = `ไฟล์: ${fileName} (พบข้อมูล ${rows.length.toLocaleString()} รายการ)`;
  previewArea.style.display = 'flex';
  btnConfirm.disabled = false;

  // Show top 5 rows
  const previewRows = rows.slice(0, 5);
  tbody.innerHTML = previewRows.map(r => `
    <tr>
      <td><span class="badge-id">${r.EmployeeID}</span></td>
      <td><strong>${r.EmpName}</strong></td>
      <td>${r.EmpPosition}</td>
      <td>${r.EmpBranch}</td>
      <td>${r.EmpZone}</td>
      <td>${r.EmpRH}</td>
      <td><span class="badge-group badge-group-${r.Group || 'default'}">${r.Group}</span></td>
      <td>${r.Member ? `<span class="badge-member">${escapeHtml(r.Member)}</span>` : '-'}</td>
    </tr>
  `).join('');
}

async function uploadParsedDataToDatabase() {
  const rows = state.parsedUploadRows;
  if (!rows || rows.length === 0) return;

  const btnConfirm = document.getElementById('btnConfirmUpload');
  const progressWrap = document.getElementById('uploadProgressWrap');
  const fill = document.getElementById('uploadProgressFill');
  const percentText = document.getElementById('progressPercent');
  const progressText = document.getElementById('progressText');

  btnConfirm.disabled = true;
  progressWrap.style.display = 'flex';

  const total = rows.length;

  if (state.db) {
    // Batch upload to Firestore
    progressText.textContent = `กำลังบันทึกข้อมูล ${total} รายการลง Firebase Firestore...`;
    
    try {
      const batchSize = 400;
      for (let i = 0; i < total; i += batchSize) {
        const batch = state.db.batch();
        const chunk = rows.slice(i, i + batchSize);

        chunk.forEach(emp => {
          const docRef = state.db.collection(state.collectionName).doc(emp.EmployeeID);
          batch.set(docRef, emp, { merge: true });
        });

        await batch.commit();
        const progress = Math.min(100, Math.round(((i + chunk.length) / total) * 100));
        fill.style.width = `${progress}%`;
        percentText.textContent = `${progress}%`;
      }

      showToast(`บันทึกข้อมูล ${total} รายการลง Firebase สำเร็จ!`, "success");
      modal.classList.remove('is-active');
      document.body.style.overflow = '';
    } catch (err) {
      console.error("Firestore batch upload error:", err);
      showToast("อัปโหลดไปยัง Firestore ล้มเหลว ทำการบันทึกลง Local Cache แทน", "error");
      fallbackLocalUpload();
    }
  } else {
    fallbackLocalUpload();
  }

  function fallbackLocalUpload() {
    // Merge into local state
    const existingMap = new Map();
    state.employees.forEach(e => existingMap.set(e.EmployeeID, e));
    rows.forEach(e => existingMap.set(e.EmployeeID, e));
    state.employees = Array.from(existingMap.values());
    saveToLocalStorage(state.employees);
    onDataUpdated();

    fill.style.width = `100%`;
    percentText.textContent = `100%`;
    setTimeout(() => {
      showToast(`นำเข้าข้อมูล ${total} รายการเข้าสู่ระบบเรียบร้อยแล้ว`, "success");
      modal.classList.remove('is-active');
      document.body.style.overflow = '';
    }, 400);
  }
}

// Download Sample Template
function downloadTemplateExcel() {
  if (typeof XLSX === 'undefined') return;

  const sampleData = [
    { EmployeeID: "20138", EmpName: "ธีรวัฒน์ นามะสงค์", EmpPosition: "ABM", EmpBranch: "สาขาโรงพยาบาลกรุงเทพ-ภูเก็ต", EmpZone: "ภูเก็ต", EmpRH: "RH5", Group: "BBD", Member: "ปี 2026" },
    { EmployeeID: "20145", EmpName: "อรวรรณ ศรีเสวต", EmpPosition: "ABM", EmpBranch: "สาขาท้ายเหมือง", EmpZone: "ภูเก็ต", EmpRH: "RH5", Group: "AL", Member: "ปี 2026" },
    { EmployeeID: "20166", EmpName: "ก้องนภา มิสวิล", EmpPosition: "CFSA", EmpBranch: "สาขาสุราษฎร์ธานี", EmpZone: "สุราษฎร์ธานี", EmpRH: "RH5", Group: "MDS", Member: "ปี 2026" },
    { EmployeeID: "20424", EmpName: "จารุวรรณ ศิรินาวี", EmpPosition: "CFSA", EmpBranch: "สาขาดำเนินสะดวก", EmpZone: "ราชบุรี", EmpRH: "RH5", Group: "T-Con", Member: "ปี 2026" }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Employee");
  XLSX.writeFile(wb, "Template_Employee_Upload.xlsx");
}

// Export All Employees to Excel
function exportAllEmployeesExcel() {
  if (typeof XLSX === 'undefined') return;

  const data = state.employees.map((e, idx) => ({
    "ลำดับ": idx + 1,
    "EmployeeID": e.EmployeeID,
    "EmpName": e.EmpName || "",
    "EmpPosition": e.EmpPosition || "",
    "EmpBranch": e.EmpBranch || "",
    "EmpZone": e.EmpZone || "",
    "EmpRH": e.EmpRH || "",
    "Group": e.Group || "",
    "Member": e.Member || "",
    "MemberDate": e.MemberDate || "",
    "สถานะรับเหรียญ": e.MemberDate ? "รับเหรียญแล้ว" : "ยังไม่ได้รับ",
    "สถานะลงทะเบียน": e.isRegistered ? "ลงทะเบียนแล้ว" : "ยังไม่ลงทะเบียน",
    "เวลาลงทะเบียน": e.registeredAt || "",
    "รางวัลที่ได้รับ": e.RewardName || "-",
    "เวลาที่สุ่มรางวัล": e.RewardTime || "-",
    "สถานะรับรางวัล": e.RewardStatus || "-"
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "All_Employees");
  XLSX.writeFile(wb, `AL_Employees_All_${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast("ส่งออกข้อมูลพนักงานทั้งหมดสำเร็จ", "success");
}

// Export Registered Employees to Excel
function exportRegisteredExcel() {
  if (typeof XLSX === 'undefined') return;

  const registered = state.employees.filter(e => e.isRegistered);
  const data = registered.map((e, idx) => ({
    "ลำดับ": idx + 1,
    "EmployeeID": e.EmployeeID,
    "EmpName": e.EmpName || "",
    "EmpPosition": e.EmpPosition || "",
    "EmpBranch": e.EmpBranch || "",
    "EmpZone": e.EmpZone || "",
    "EmpRH": e.EmpRH || "",
    "Group": e.Group || "",
    "Member": e.Member || "",
    "เวลาลงทะเบียน": e.registeredAt || "",
    "รางวัลที่ได้รับ": e.RewardName || "-",
    "เวลาที่สุ่มรางวัล": e.RewardTime || "-",
    "สถานะรับรางวัล": e.RewardStatus || "-"
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Registered_List");
  XLSX.writeFile(wb, `AL_Registered_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast("ส่งออกรายชื่อผู้ลงทะเบียนสำเร็จ", "success");
}

// =============================================================================
// MODAL: ADD / EDIT EMPLOYEE
// =============================================================================
function initAddEmployeeModal() {
  const modal = document.getElementById('modalAddEmp');
  const btnOpen = document.getElementById('btnOpenAddEmpModal');
  const btnClose = document.getElementById('btnCloseAddEmpModal');
  const btnCancel = document.getElementById('btnCancelEmpForm');
  const form = document.getElementById('empForm');

  btnOpen.addEventListener('click', () => {
    form.reset();
    document.getElementById('formEmpRH').value = 'RH5';
    if (document.getElementById('formMember')) {
      document.getElementById('formMember').value = '';
    }
    modal.classList.add('is-active');
    document.body.style.overflow = 'hidden';
  });

  const closeAddEmp = () => {
    modal.classList.remove('is-active');
    document.body.style.overflow = '';
  };

  btnClose.addEventListener('click', closeAddEmp);
  btnCancel.addEventListener('click', closeAddEmp);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeAddEmp();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const empId = document.getElementById('formEmpId').value.trim();
    const empName = document.getElementById('formEmpName').value.trim();
    const empPosition = document.getElementById('formEmpPosition').value.trim();
    const empBranch = document.getElementById('formEmpBranch').value.trim();
    const empZone = document.getElementById('formEmpZone').value.trim();
    const empRH = document.getElementById('formEmpRH').value.trim() || 'RH5';
    const group = document.getElementById('formGroup').value.trim();
    const member = document.getElementById('formMember') ? document.getElementById('formMember').value.trim() : '';

    if (!empId || !empName) {
      showToast("กรุณากรอกรหัสพนักงานและชื่อ-นามสกุล", "error");
      return;
    }

    const newEmp = {
      EmployeeID: empId,
      EmpName: empName,
      EmpPosition: empPosition,
      EmpBranch: empBranch,
      EmpZone: empZone,
      EmpRH: empRH,
      Group: group,
      Member: member,
      isRegistered: false,
      registeredAt: null
    };

    if (state.db) {
      state.db.collection(state.collectionName).doc(empId).set(newEmp, { merge: true })
        .then(() => {
          showToast(`เพิ่มพนักงานรหัส ${empId} สำเร็จ`, "success");
          modal.classList.remove('is-active');
        })
        .catch(err => {
          console.error("Save emp error:", err);
          saveLocal();
        });
    } else {
      saveLocal();
    }

    function saveLocal() {
      const idx = state.employees.findIndex(x => x.EmployeeID === empId);
      if (idx !== -1) {
        state.employees[idx] = { ...state.employees[idx], ...newEmp };
      } else {
        state.employees.unshift(newEmp);
      }
      saveToLocalStorage(state.employees);
      onDataUpdated();
      showToast(`เพิ่มพนักงานรหัส ${empId} สำเร็จ (Local)`, "success");
      modal.classList.remove('is-active');
    }
  });
}

// Toast Notifications Helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>`;
  if (type === 'success') {
    icon = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>`;
  } else if (type === 'error') {
    icon = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>`;
  }

  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// =============================================================================
// TAB: REWARDS MANAGEMENT (AL_Reward)
// =============================================================================
const REWARD_GROUPS = [
  'Group-1',
  'Group-2',
  'Group-3',
  'Group-4',
  'Group-5',
  'Group-6',
  'Group-7',
  'Group-8',
  'Group-9',
  'Group Extra'
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

// ลบโค้ดของรางวัลจำลองออกทั้งหมด เพื่อไม่ให้มีการนำข้อมูลจำลองมาปนในตารางใช้งานจริง
const DEFAULT_REWARDS = [];

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getDrawnCountForPrize(rewardOrName) {
  if (!rewardOrName) return 0;
  if (typeof rewardOrName === 'string') {
    const nameTrimmed = rewardOrName.trim().toLowerCase();
    return state.employees.filter(e => e.RewardName && String(e.RewardName).trim().toLowerCase() === nameTrimmed).length;
  }
  const r = rewardOrName;
  const rId = String(r.id || '').trim();
  const rOwner = String(r.owner || '').trim().replace(/^คุณ\s*/, '').toLowerCase();
  const rName = String(r.name || '').trim().toLowerCase();

  return state.employees.filter(e => {
    if (!e || !e.RewardName) return false;
    const eName = String(e.RewardName).trim().toLowerCase();
    if (eName !== rName) return false;

    // Match by RewardId
    if (rId && e.RewardId && String(e.RewardId).trim() === rId) return true;

    // Match by RewardOwner / RewardExecutive
    const eOwner = String(e.RewardOwner || e.RewardExecutive || '').trim().replace(/^คุณ\s*/, '').toLowerCase();
    if (rOwner && eOwner && eOwner === rOwner) return true;

    // If reward has no owner or id specified, match if e has no owner/id
    if (!rOwner && !eOwner) return true;

    return false;
  }).length;
}

function getSavedRewards() {
  try {
    const raw = localStorage.getItem('AL_REWARDS_DATA');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveRewardsToLocalStorage(list) {
  try {
    localStorage.setItem('AL_REWARDS_DATA', JSON.stringify(list));
    broadcastRewardsChange();
  } catch (e) {}
}

function loadRewardsFromLocalStorage() {
  const saved = getSavedRewards();
  if (saved && saved.length > 0) {
    let modified = false;
    saved.forEach((r, idx) => {
      if (!r.group || r.group === 'ALL' || ['AL', 'BBD', 'MDS', 'T-Con'].includes(r.group)) {
        r.group = `Group-${(idx % 10) + 1}`;
        modified = true;
      }
    });
    state.rewards = saved;
    if (modified) saveRewardsToLocalStorage(state.rewards);
  } else {
    // ลบการใส่ของรางวัลจำลองออก หากไม่มีข้อมูลให้เป็น array ว่าง
    state.rewards = [];
  }
  onRewardsUpdated();
}

function listenToRewardsFirestore() {
  if (!state.db) return;
  if (state.unsubscribeRewardsSnapshot) {
    state.unsubscribeRewardsSnapshot();
  }

  state.unsubscribeRewardsSnapshot = state.db.collection(state.rewardsCollection)
    .orderBy('order', 'asc')
    .onSnapshot((snapshot) => {
      if (snapshot.empty) {
        state.rewards = [];
        saveRewardsToLocalStorage([]);
      } else {
        const list = [];
        const seenIds = new Set();
        snapshot.forEach(doc => {
          if (doc.id.startsWith('_') || (doc.data() && doc.data().isControlDoc)) return;
          if (!seenIds.has(doc.id)) {
            seenIds.add(doc.id);
            list.push({ id: doc.id, ...doc.data() });
          }
        });
        list.sort(compareRewardGroups);
        state.rewards = list;
        saveRewardsToLocalStorage(list);
      }
      onRewardsUpdated();
    }, (err) => {
      console.warn("Rewards Firestore onSnapshot error:", err);
      loadRewardsFromLocalStorage();
    });
}

function onRewardsUpdated() {
  updateRewardKPIs();
  renderRewardsTable();
  populateLuckyDrawPrizeSelect();
  const totalRewardQty = (state.rewards || []).reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  const badgeRewards = document.getElementById('badgeRewardsCount');
  if (badgeRewards) badgeRewards.textContent = totalRewardQty.toLocaleString();
}

function renderRewardsView() {
  updateRewardKPIs();
  renderRewardsTable();
}

function updateRewardKPIs() {
  const totalItems = state.rewards.length;
  let totalQty = 0;
  let totalDrawn = 0;

  state.rewards.forEach(r => {
    const q = Number(r.quantity) || 0;
    totalQty += q;
    totalDrawn += getDrawnCountForPrize(r.name);
  });

  const remainingQty = Math.max(0, totalQty - totalDrawn);
  const drawnPercent = totalQty > 0 ? Math.round((totalDrawn / totalQty) * 100) : 0;

  const kpiItems = document.getElementById('kpiRewardTotalItems');
  const kpiQty = document.getElementById('kpiRewardTotalQty');
  const kpiDrawn = document.getElementById('kpiRewardDrawnQty');
  const kpiRemain = document.getElementById('kpiRewardRemainingQty');
  const kpiDrawnHint = document.getElementById('kpiRewardDrawnHint');
  const badgeRewards = document.getElementById('badgeRewardsCount');

  // แสดงผลคำนวณจากจำนวนของรางวัลทั้งหมด (Total Quantity)
  if (kpiItems) kpiItems.textContent = totalQty.toLocaleString();
  if (kpiQty) kpiQty.textContent = totalQty.toLocaleString();
  if (kpiDrawn) kpiDrawn.textContent = totalDrawn.toLocaleString();
  if (kpiRemain) kpiRemain.textContent = remainingQty.toLocaleString();
  if (kpiDrawnHint) kpiDrawnHint.textContent = `${drawnPercent}% ของรางวัลทั้งหมด`;
  if (badgeRewards) badgeRewards.textContent = totalQty.toLocaleString();
}

function renderRewardsTable() {
  const tbody = document.getElementById('rewardsTableBody');
  if (!tbody) return;

  if (!state.rewards || state.rewards.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="td-empty">ยังไม่มีรายการของรางวัล สามารถกดปุ่ม "+ เพิ่มของรางวัลใหม่" ด้านบนเพื่อเริ่มกำหนดรางวัล</td></tr>`;
    return;
  }

  // Ensure state.rewards has no duplicate IDs
  const uniqueRewards = [];
  const seenRewardIds = new Set();
  (state.rewards || []).forEach(r => {
    const rid = r.id || `${r.name}_${r.group}_${r.order}`;
    if (!seenRewardIds.has(rid)) {
      seenRewardIds.add(rid);
      uniqueRewards.push(r);
    }
  });
  state.rewards = uniqueRewards;

  // Ensure sorted by Group ascending (Group-1 -> Group Extra), then by order
  state.rewards.sort(compareRewardGroups);

  let displayRewards = [...state.rewards];
  if (state.filterRewardGroup && state.filterRewardGroup !== 'ALL') {
    displayRewards = displayRewards.filter(r => (r.group || 'Group-1') === state.filterRewardGroup);
  }

  if (displayRewards.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" class="td-empty">ไม่พบของรางวัลในกลุ่ม "${escapeHtml(state.filterRewardGroup)}"</td></tr>`;
    return;
  }

  tbody.innerHTML = displayRewards.map((r, idx) => {
    const totalQty = Number(r.quantity) || 0;
    const drawn = getDrawnCountForPrize(r);
    const remain = Math.max(0, totalQty - drawn);
    const isFirst = idx === 0;
    const isLast = idx === displayRewards.length - 1;

    // Executive Photo & Position
    const ownerImgVal = r.ownerImage || r.ownerImageUrl || r.executiveImage || '';
    const ownerThumbHtml = ownerImgVal && ownerImgVal.trim() !== ''
      ? `<div class="reward-owner-avatar-wrap">
           <img src="${escapeHtml(ownerImgVal)}" class="reward-owner-avatar-img" alt="${escapeHtml(r.owner || 'ผู้บริหาร')}" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'reward-owner-placeholder\\'>👤</span>';">
         </div>`
      : `<div class="reward-owner-avatar-wrap"><span class="reward-owner-placeholder">👤</span></div>`;

    const ownerPositionVal = r.ownerPosition || r.position || r.executivePosition || '';

    // Thumbnail / Media
    const thumbHtml = r.imageUrl && r.imageUrl.trim() !== ''
      ? `<div class="reward-thumb-wrap">
           <img src="${escapeHtml(r.imageUrl)}" class="reward-thumb-img" alt="${escapeHtml(r.name)}" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'reward-thumb-placeholder\\'>🎁</span>';">
         </div>`
      : `<div class="reward-thumb-wrap"><span class="reward-thumb-placeholder">🎁</span></div>`;

    // Group Select Dropdown
    const curGroup = r.group || 'Group-1';
    const isStandardGroup = REWARD_GROUPS.includes(curGroup);
    const groupOptionsHtml = REWARD_GROUPS.map(g =>
      `<option value="${g}" ${curGroup === g ? 'selected' : ''}>${g}</option>`
    ).join('');

    const groupClass = curGroup.replace(/\s+/g, '-');
    const groupHtml = `
      <div class="reward-group-dropdown-wrap">
        <select class="reward-group-select badge-group badge-group-${escapeHtml(groupClass)}" 
                onchange="window.changeRewardGroup('${r.id}', this.value)" 
                title="คลิกเพื่อเปลี่ยนกลุ่มของรางวัล">
          ${groupOptionsHtml}
          ${!isStandardGroup && curGroup !== 'ALL' ? `<option value="${escapeHtml(curGroup)}" selected>${escapeHtml(curGroup)}</option>` : ''}
          <option value="__CUSTOM__">+ ระบุกลุ่มใหม่...</option>
        </select>
        ${r.groupName ? `<div class="reward-group-name-tag" title="ชื่อกลุ่ม: ${escapeHtml(r.groupName)}">🏷️ ${escapeHtml(r.groupName)}</div>` : ''}
      </div>
    `;

    // URL link
    const urlHtml = r.imageUrl && r.imageUrl.trim() !== ''
      ? `<div class="reward-url-cell"><a href="${escapeHtml(r.imageUrl)}" target="_blank" rel="noopener noreferrer" class="reward-url-link" title="${escapeHtml(r.imageUrl)}">
           <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
           <span>${escapeHtml(r.imageUrl)}</span>
         </a></div>`
      : `<span class="reward-url-empty">- ไม่มีรูป -</span>`;

    return `
      <tr>
        <td style="text-align: center;">
          <span class="reward-order-badge">#${idx + 1}</span>
        </td>
        <td style="text-align: center;">${thumbHtml}</td>
        <td style="text-align: center;">${groupHtml}</td>
        <td>
          <div class="reward-name-text">${escapeHtml(r.name || '-')}</div>
        </td>
        <td style="text-align: center;">${ownerThumbHtml}</td>
        <td style="text-align: center;">
          <div class="reward-owner-text" title="${escapeHtml(r.owner || '-')}">${escapeHtml(r.owner || '-')}</div>
        </td>
        <td style="text-align: center;">
          <div class="reward-position-text" title="${escapeHtml(ownerPositionVal || '-')}">${escapeHtml(ownerPositionVal || '-')}</div>
        </td>
        <td style="text-align: center;">
          <span class="reward-qty-badge">${totalQty} ชิ้น</span>
        </td>
        <td style="text-align: center;">
          <span class="reward-drawn-badge">${drawn} ชิ้น</span>
        </td>
        <td style="text-align: center;">
          <span class="reward-remain-badge ${remain <= 0 ? 'empty' : ''}">${remain} ชิ้น</span>
        </td>
        <td style="text-align: center;">
          <div class="reorder-btn-group">
            <button type="button" class="btn-reorder" onclick="moveRewardOrder('${r.id}', -1)" title="เลื่อนขึ้น" ${isFirst ? 'disabled' : ''}>▲</button>
            <button type="button" class="btn-reorder" onclick="moveRewardOrder('${r.id}', 1)" title="เลื่อนลง" ${isLast ? 'disabled' : ''}>▼</button>
          </div>
        </td>
        <td style="text-align: center;">
          <div class="reward-actions-group">
            <button type="button" class="btn-action-edit" onclick="openEditRewardModal('${r.id}')" title="แก้ไขรายการ">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              <span>แก้ไข</span>
            </button>
            <button type="button" class="btn-action-delete" onclick="openDeleteRewardModal('${r.id}')" title="ลบรายการ">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              <span>ลบ</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.changeRewardGroup = async function(rewardId, newGroup) {
  let targetGroup = newGroup;
  if (targetGroup === '__CUSTOM__') {
    const customInput = prompt("กรุณาระบุชื่อกลุ่มของรางวัลที่ต้องการเปลี่ยน:");
    if (!customInput || customInput.trim() === '') {
      renderRewardsTable();
      return;
    }
    targetGroup = customInput.trim();
  }

  const reward = state.rewards.find(r => r.id === rewardId);
  if (!reward) return;

  const oldGroup = reward.group || 'ALL';
  reward.group = targetGroup;
  reward.updatedAt = new Date().toISOString();

  try {
    if (state.db) {
      await state.db.collection(state.rewardsCollection).doc(rewardId).set({
        group: targetGroup,
        updatedAt: reward.updatedAt
      }, { merge: true });
    }
    saveRewardsToLocalStorage(state.rewards);
    onRewardsUpdated();
    showToast(`เปลี่ยนกลุ่มของรางวัล "${reward.name}" เป็น "${targetGroup}" สำเร็จ`, "success");
  } catch (err) {
    console.error("Error updating reward group:", err);
    reward.group = oldGroup;
    showToast("เกิดข้อผิดพลาดในการเปลี่ยนกลุ่มของรางวัล", "error");
    renderRewardsTable();
  }
};

function initRewardsManager() {
  const modal = document.getElementById('modalReward');
  const btnOpenAdd = document.getElementById('btnOpenAddRewardModal');
  const btnClose = document.getElementById('btnCloseRewardModal');
  const btnCancel = document.getElementById('btnCancelRewardForm');
  const form = document.getElementById('rewardForm');
  const btnRefresh = document.getElementById('btnRefreshRewards');
  const imgInput = document.getElementById('formRewardImageUrl');
  const previewWrap = document.getElementById('rewardModalPreviewWrap');
  const previewImg = document.getElementById('rewardModalPreviewImg');

  if (btnOpenAdd) {
    btnOpenAdd.addEventListener('click', openAddRewardModal);
  }

  const closeRewardModal = () => {
    if (modal) {
      modal.classList.remove('is-active');
      document.body.style.overflow = '';
    }
  };

  if (btnClose) btnClose.addEventListener('click', closeRewardModal);
  if (btnCancel) btnCancel.addEventListener('click', closeRewardModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeRewardModal();
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      if (state.db) {
        listenToRewardsFirestore();
      } else {
        loadRewardsFromLocalStorage();
      }
      showToast("รีเฟรชข้อมูลของรางวัลเรียบร้อย", "info");
    });
  }

  // Group filter for rewards table
  const filterGroupSelect = document.getElementById('filterRewardGroup');
  if (filterGroupSelect) {
    filterGroupSelect.addEventListener('change', (e) => {
      state.filterRewardGroup = e.target.value;
      renderRewardsTable();
    });
  }

  // Modal group custom toggle
  const modalGroupSelect = document.getElementById('formRewardGroup');
  const modalGroupCustom = document.getElementById('formRewardGroupCustom');
  if (modalGroupSelect && modalGroupCustom) {
    modalGroupSelect.addEventListener('change', () => {
      if (modalGroupSelect.value === 'CUSTOM') {
        modalGroupCustom.style.display = 'block';
        modalGroupCustom.focus();
      } else {
        modalGroupCustom.style.display = 'none';
        modalGroupCustom.value = '';
      }
    });
  }

  // Live image preview in modal (Prize Image)
  if (imgInput && previewWrap && previewImg) {
    imgInput.addEventListener('input', () => {
      const val = imgInput.value.trim();
      if (val) {
        previewImg.src = val;
        previewWrap.style.display = 'block';
      } else {
        previewWrap.style.display = 'none';
        previewImg.src = '';
      }
    });
  }

  // Live image preview in modal (Executive Photo)
  const ownerImgInput = document.getElementById('formRewardOwnerImage');
  const ownerPreviewWrap = document.getElementById('rewardOwnerPreviewWrap');
  const ownerPreviewImg = document.getElementById('rewardOwnerPreviewImg');
  if (ownerImgInput && ownerPreviewWrap && ownerPreviewImg) {
    ownerImgInput.addEventListener('input', () => {
      const val = ownerImgInput.value.trim();
      if (val) {
        ownerPreviewImg.src = val;
        ownerPreviewWrap.style.display = 'block';
      } else {
        ownerPreviewWrap.style.display = 'none';
        ownerPreviewImg.src = '';
      }
    });
  }

  // Form submit
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const docId = document.getElementById('formRewardDocId').value.trim();
      const orderVal = parseInt(document.getElementById('formRewardOrder').value, 10) || 1;
      const nameVal = document.getElementById('formRewardName').value.trim();
      const groupNameVal = document.getElementById('formRewardGroupName') ? document.getElementById('formRewardGroupName').value.trim() : '';
      const ownerVal = document.getElementById('formRewardOwner') ? document.getElementById('formRewardOwner').value.trim() : '';
      const ownerPositionVal = document.getElementById('formRewardOwnerPosition') ? document.getElementById('formRewardOwnerPosition').value.trim() : '';
      const ownerImageVal = document.getElementById('formRewardOwnerImage') ? document.getElementById('formRewardOwnerImage').value.trim() : '';
      const isIndividualDraw = document.getElementById('formRewardIndividualDraw') ? document.getElementById('formRewardIndividualDraw').checked : false;
      const qtyVal = parseInt(document.getElementById('formRewardQuantity').value, 10) || 1;
      const imgVal = document.getElementById('formRewardImageUrl').value.trim();

      const groupSelectVal = modalGroupSelect ? modalGroupSelect.value : 'Group-1';
      const groupCustomVal = modalGroupCustom ? modalGroupCustom.value.trim() : '';
      const groupVal = (groupSelectVal === 'CUSTOM' ? groupCustomVal : groupSelectVal) || 'Group-1';

      if (!nameVal) {
        showToast("กรุณาระบุชื่อรายการของรางวัล", "error");
        return;
      }

      const rewardData = {
        order: orderVal,
        name: nameVal,
        groupName: groupNameVal,
        owner: ownerVal,
        ownerPosition: ownerPositionVal,
        ownerImage: ownerImageVal,
        isIndividualDraw: isIndividualDraw,
        quantity: qtyVal,
        group: groupVal,
        imageUrl: imgVal,
        updatedAt: new Date().toISOString()
      };

      const btnSaveReward = document.getElementById('btnSaveReward');
      if (btnSaveReward) {
        btnSaveReward.disabled = true;
        btnSaveReward.textContent = 'กำลังบันทึก...';
      }

      try {
        if (docId) {
          // Edit existing
          if (state.db) {
            await state.db.collection(state.rewardsCollection).doc(docId).set(rewardData, { merge: true });
          }
          const item = state.rewards.find(r => r.id === docId);
          if (item) {
            Object.assign(item, rewardData);
          }
          showToast(`แก้ไขของรางวัล "${nameVal}" สำเร็จ`, "success");
        } else {
          // Add new
          rewardData.createdAt = new Date().toISOString();
          if (state.db) {
            const docRef = await state.db.collection(state.rewardsCollection).add(rewardData);
            rewardData.id = docRef.id;
            // Prevent duplicate insertion if onSnapshot already pushed it
            const alreadyExists = state.rewards.some(r => r.id === docRef.id);
            if (!alreadyExists) {
              state.rewards.push(rewardData);
            }
          } else {
            rewardData.id = 'rew_' + Date.now();
            state.rewards.push(rewardData);
          }
          state.rewards.sort(compareRewardGroups);
          showToast(`เพิ่มของรางวัล "${nameVal}" เรียบร้อยแล้ว`, "success");
        }

        saveRewardsToLocalStorage(state.rewards);
        onRewardsUpdated();
        closeRewardModal();
      } catch (err) {
        console.error("Error saving reward:", err);
        showToast("เกิดข้อผิดพลาดในการบันทึกของรางวัล", "error");
      } finally {
        if (btnSaveReward) {
          btnSaveReward.disabled = false;
          btnSaveReward.textContent = 'บันทึกของรางวัล';
        }
      }
    });
  }

  // Delete Reward Lightbox Modal Event Handlers
  const modalDelete = document.getElementById('modalDeleteRewardConfirm');
  const btnCloseDelete = document.getElementById('btnCloseDeleteRewardModal');
  const btnCancelDelete = document.getElementById('btnCancelDeleteReward');
  const btnConfirmDelete = document.getElementById('btnConfirmDeleteReward');

  const closeDeleteRewardModal = () => {
    if (modalDelete) {
      modalDelete.classList.remove('is-active');
      document.body.style.overflow = '';
    }
    window.pendingDeleteRewardId = null;
  };

  if (btnCloseDelete) btnCloseDelete.addEventListener('click', closeDeleteRewardModal);
  if (btnCancelDelete) btnCancelDelete.addEventListener('click', closeDeleteRewardModal);
  if (modalDelete) {
    modalDelete.addEventListener('click', (e) => {
      if (e.target === modalDelete) closeDeleteRewardModal();
    });
  }

  if (btnConfirmDelete) {
    btnConfirmDelete.addEventListener('click', async () => {
      if (!window.pendingDeleteRewardId) return;
      const targetId = window.pendingDeleteRewardId;
      const reward = state.rewards.find(r => r.id === targetId);
      const rewardName = reward ? reward.name : '';

      try {
        btnConfirmDelete.disabled = true;
        btnConfirmDelete.textContent = 'กำลังลบข้อมูล...';

        if (state.db) {
          await state.db.collection(state.rewardsCollection).doc(targetId).delete();
        }
        state.rewards = state.rewards.filter(r => r.id !== targetId);
        saveRewardsToLocalStorage(state.rewards);
        onRewardsUpdated();
        closeDeleteRewardModal();
        showToast(`ลบของรางวัล "${rewardName}" เรียบร้อยแล้ว`, "success");
      } catch (err) {
        console.error("Error deleting reward:", err);
        showToast("เกิดข้อผิดพลาดในการลบของรางวัล", "error");
      } finally {
        btnConfirmDelete.disabled = false;
        btnConfirmDelete.textContent = 'ยืนยันลบข้อมูล';
      }
    });
  }
}

window.openAddRewardModal = function() {
  const modal = document.getElementById('modalReward');
  const title = document.getElementById('modalRewardTitle');
  const form = document.getElementById('rewardForm');
  const previewWrap = document.getElementById('rewardModalPreviewWrap');
  const previewImg = document.getElementById('rewardModalPreviewImg');

  if (!modal || !form) return;
  form.reset();
  document.getElementById('formRewardDocId').value = '';
  if (title) title.textContent = 'เพิ่มของรางวัลใหม่';

  // Suggest next order
  const maxOrder = state.rewards.reduce((max, r) => Math.max(max, Number(r.order) || 0), 0);
  document.getElementById('formRewardOrder').value = maxOrder + 1;
  document.getElementById('formRewardQuantity').value = 1;
  const grpNameInputAdd = document.getElementById('formRewardGroupName');
  if (grpNameInputAdd) grpNameInputAdd.value = '';
  const ownerInput = document.getElementById('formRewardOwner');
  if (ownerInput) ownerInput.value = '';
  const ownerPosInput = document.getElementById('formRewardOwnerPosition');
  if (ownerPosInput) ownerPosInput.value = '';
  const ownerImgInputEl = document.getElementById('formRewardOwnerImage');
  if (ownerImgInputEl) ownerImgInputEl.value = '';
  const ownerPreviewWrapEl = document.getElementById('rewardOwnerPreviewWrap');
  if (ownerPreviewWrapEl) ownerPreviewWrapEl.style.display = 'none';
  const ownerPreviewImgEl = document.getElementById('rewardOwnerPreviewImg');
  if (ownerPreviewImgEl) ownerPreviewImgEl.src = '';
  const indivCheckAdd = document.getElementById('formRewardIndividualDraw');
  if (indivCheckAdd) indivCheckAdd.checked = false;

  const modalGroupSelect = document.getElementById('formRewardGroup');
  const modalGroupCustom = document.getElementById('formRewardGroupCustom');
  if (modalGroupSelect) modalGroupSelect.value = 'Group-1';
  if (modalGroupCustom) {
    modalGroupCustom.style.display = 'none';
    modalGroupCustom.value = '';
  }

  if (previewWrap) previewWrap.style.display = 'none';
  if (previewImg) previewImg.src = '';

  modal.classList.add('is-active');
  document.body.style.overflow = 'hidden';
};

window.openEditRewardModal = function(rewardId) {
  const modal = document.getElementById('modalReward');
  const title = document.getElementById('modalRewardTitle');
  const form = document.getElementById('rewardForm');
  const previewWrap = document.getElementById('rewardModalPreviewWrap');
  const previewImg = document.getElementById('rewardModalPreviewImg');

  if (!modal || !form) return;
  const reward = state.rewards.find(r => r.id === rewardId);
  if (!reward) return;

  if (title) title.textContent = 'แก้ไขข้อมูลของรางวัล';
  document.getElementById('formRewardDocId').value = reward.id;
  document.getElementById('formRewardOrder').value = reward.order || 1;
  document.getElementById('formRewardName').value = reward.name || '';
  const grpNameInputEdit = document.getElementById('formRewardGroupName');
  if (grpNameInputEdit) grpNameInputEdit.value = reward.groupName || '';
  const ownerEditInput = document.getElementById('formRewardOwner');
  if (ownerEditInput) ownerEditInput.value = reward.owner || '';
  const ownerPosEditInput = document.getElementById('formRewardOwnerPosition');
  if (ownerPosEditInput) ownerPosEditInput.value = reward.ownerPosition || reward.position || reward.executivePosition || '';
  const ownerImgEditInput = document.getElementById('formRewardOwnerImage');
  const curOwnerImg = reward.ownerImage || reward.ownerImageUrl || reward.executiveImage || '';
  if (ownerImgEditInput) ownerImgEditInput.value = curOwnerImg;

  const ownerPreviewWrapEdit = document.getElementById('rewardOwnerPreviewWrap');
  const ownerPreviewImgEdit = document.getElementById('rewardOwnerPreviewImg');
  if (curOwnerImg && curOwnerImg.trim() !== '') {
    if (ownerPreviewImgEdit) ownerPreviewImgEdit.src = curOwnerImg;
    if (ownerPreviewWrapEdit) ownerPreviewWrapEdit.style.display = 'block';
  } else {
    if (ownerPreviewWrapEdit) ownerPreviewWrapEdit.style.display = 'none';
    if (ownerPreviewImgEdit) ownerPreviewImgEdit.src = '';
  }

  document.getElementById('formRewardQuantity').value = reward.quantity || 1;
  document.getElementById('formRewardImageUrl').value = reward.imageUrl || '';
  const indivCheckEdit = document.getElementById('formRewardIndividualDraw');
  if (indivCheckEdit) indivCheckEdit.checked = !!(reward.isIndividualDraw === true || reward.enableIndividualDraw === true);

  const modalGroupSelect = document.getElementById('formRewardGroup');
  const modalGroupCustom = document.getElementById('formRewardGroupCustom');
  const curGroup = reward.group || 'Group-1';
  if (modalGroupSelect) {
    const isStandard = REWARD_GROUPS.includes(curGroup);
    if (isStandard) {
      modalGroupSelect.value = curGroup;
      if (modalGroupCustom) {
        modalGroupCustom.style.display = 'none';
        modalGroupCustom.value = '';
      }
    } else {
      modalGroupSelect.value = 'CUSTOM';
      if (modalGroupCustom) {
        modalGroupCustom.style.display = 'block';
        modalGroupCustom.value = curGroup;
      }
    }
  }

  if (reward.imageUrl && reward.imageUrl.trim() !== '') {
    if (previewImg) previewImg.src = reward.imageUrl;
    if (previewWrap) previewWrap.style.display = 'block';
  } else {
    if (previewWrap) previewWrap.style.display = 'none';
    if (previewImg) previewImg.src = '';
  }

  modal.classList.add('is-active');
  document.body.style.overflow = 'hidden';
};

window.pendingDeleteRewardId = null;

window.openDeleteRewardModal = function(rewardId) {
  const modal = document.getElementById('modalDeleteRewardConfirm');
  const preview = document.getElementById('deleteRewardPreview');
  const reward = state.rewards.find(r => r.id === rewardId);
  if (!modal || !reward) return;

  window.pendingDeleteRewardId = rewardId;

  const thumbHtml = reward.imageUrl && reward.imageUrl.trim() !== ''
    ? `<img src="${escapeHtml(reward.imageUrl)}" alt="${escapeHtml(reward.name)}" onerror="this.onerror=null; this.parentElement.innerHTML='🎁';">`
    : `🎁`;

  const totalQty = Number(reward.quantity) || 1;

  if (preview) {
    preview.innerHTML = `
      <div class="del-thumb">${thumbHtml}</div>
      <div class="del-info">
        <div class="del-name">${escapeHtml(reward.name || '-')}</div>
        <div class="del-meta">
          <span>ลำดับ: #${reward.order || '-'}</span>
          <span>•</span>
          <span>จำนวน: ${totalQty} ชิ้น</span>
        </div>
      </div>
    `;
  }

  modal.classList.add('is-active');
  document.body.style.overflow = 'hidden';
};

// Fallback for any legacy calls
window.deleteRewardItem = window.openDeleteRewardModal;

window.moveRewardOrder = async function(rewardId, direction) {
  const sorted = [...state.rewards].sort(compareRewardGroups);
  const idx = sorted.findIndex(r => r.id === rewardId);
  if (idx < 0) return;

  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= sorted.length) return;

  const currentItem = sorted[idx];
  const targetItem = sorted[targetIdx];

  // Swap orders
  const tempOrder = currentItem.order;
  currentItem.order = targetItem.order;
  targetItem.order = tempOrder;

  // If both had identical order values, enforce distinction
  if (currentItem.order === targetItem.order) {
    if (direction < 0) {
      currentItem.order = Math.max(1, targetItem.order - 1);
    } else {
      currentItem.order = targetItem.order + 1;
    }
  }

  try {
    if (state.db) {
      await Promise.all([
        state.db.collection(state.rewardsCollection).doc(currentItem.id).set({ order: currentItem.order }, { merge: true }),
        state.db.collection(state.rewardsCollection).doc(targetItem.id).set({ order: targetItem.order }, { merge: true })
      ]);
    }
    saveRewardsToLocalStorage(state.rewards);
    onRewardsUpdated();
    showToast("ปรับลำดับของรางวัลเรียบร้อย", "info");
  } catch (err) {
    console.error("Error swapping reward order:", err);
    saveRewardsToLocalStorage(state.rewards);
    onRewardsUpdated();
  }
};

function populateLuckyDrawPrizeSelect() {
  const prizeSelect = document.getElementById('drawPrizeSelect');
  if (!prizeSelect) return;

  const currentVal = prizeSelect.value;
  const sorted = [...state.rewards].sort(compareRewardGroups);

  if (sorted.length === 0) {
    prizeSelect.innerHTML = `
      <option value="">-- ยังไม่มีของรางวัลในตาราง AL_Reward --</option>
      <option value="CUSTOM">-- ระบุชื่อของรางวัลเอง (Custom) --</option>
    `;
    updateSelectedPrizePreview();
    return;
  }

  let html = '';
  sorted.forEach((r, idx) => {
    const drawn = getDrawnCountForPrize(r.name);
    const remain = Math.max(0, (Number(r.quantity) || 0) - drawn);
    const statusNote = remain === 0 ? ' (หมดแล้ว)' : ` (คงเหลือ: ${remain}/${r.quantity})`;
    const isSelected = currentVal ? currentVal === r.name : idx === 0;
    const groupTag = r.group && r.group !== 'ALL' ? ` [${escapeHtml(r.group)}]` : '';

    html += `<option value="${escapeHtml(r.name)}" data-id="${r.id}" data-qty="${r.quantity}" data-drawn="${drawn}" data-remain="${remain}" data-group="${escapeHtml(r.group || 'ALL')}" data-img="${escapeHtml(r.imageUrl || '')}" ${isSelected ? 'selected' : ''}>
      ${r.order ? r.order + '. ' : ''}${escapeHtml(r.name)}${groupTag}${statusNote}
    </option>`;
  });

  const isCustomSelected = currentVal === 'CUSTOM';
  html += `<option value="CUSTOM" ${isCustomSelected ? 'selected' : ''}>-- ระบุชื่อของรางวัลเอง (Custom) --</option>`;

  prizeSelect.innerHTML = html;
  updateSelectedPrizePreview();
}

function updateSelectedPrizePreview() {
  const prizeSelect = document.getElementById('drawPrizeSelect');
  const customInput = document.getElementById('drawPrizeCustomInput');
  const previewBox = document.getElementById('drawPrizeSelectedPreview');
  const previewMedia = document.getElementById('drawPrizePreviewMedia');
  const previewTitle = document.getElementById('drawPrizePreviewTitle');
  const previewQty = document.getElementById('drawPrizePreviewQty');
  const previewDrawn = document.getElementById('drawPrizePreviewDrawn');
  const previewRemain = document.getElementById('drawPrizePreviewRemain');

  if (!prizeSelect || !previewBox) return;

  const val = prizeSelect.value;
  if (!val || val === 'CUSTOM') {
    previewBox.style.display = 'none';
    if (customInput && val === 'CUSTOM') {
      customInput.style.display = 'block';
    }
    return;
  }

  if (customInput) customInput.style.display = 'none';

  const reward = state.rewards.find(r => r.name === val);
  const totalQty = reward ? Number(reward.quantity) || 0 : 0;
  const drawn = getDrawnCountForPrize(val);
  const remain = Math.max(0, totalQty - drawn);
  const imgUrl = reward ? reward.imageUrl : '';

  previewBox.style.display = 'flex';
  const grpText = reward && reward.group && reward.group !== 'ALL' ? ` [กลุ่ม: ${reward.group}]` : '';
  if (previewTitle) previewTitle.textContent = `${val}${grpText}`;
  if (previewQty) previewQty.textContent = `ทั้งหมด: ${totalQty} ชิ้น`;
  if (previewDrawn) previewDrawn.textContent = `สุ่มแล้ว: ${drawn} ชิ้น`;

  if (previewRemain) {
    previewRemain.textContent = `คงเหลือ: ${remain} ชิ้น`;
    if (remain <= 0) {
      previewRemain.classList.add('empty');
      previewRemain.textContent = 'คงเหลือ: 0 (ครบโควตาแล้ว)';
    } else {
      previewRemain.classList.remove('empty');
    }
  }

  if (previewMedia) {
    if (imgUrl && imgUrl.trim() !== '') {
      previewMedia.innerHTML = `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(val)}" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'prize-preview-icon\\'>🎁</span>';">`;
    } else {
      previewMedia.innerHTML = `<span class="prize-preview-icon">🎁</span>`;
    }
  }
}

// =============================================================================
// TAB 3: LUCKY DRAW (ระบบสุ่มของรางวัล)
// =============================================================================
let isDrawRunning = false;

function initLuckyDraw() {
  const prizeSelect = document.getElementById('drawPrizeSelect');
  const customInput = document.getElementById('drawPrizeCustomInput');
  const qtyInput = document.getElementById('drawQuantityInput');
  const btnQtyMinus = document.getElementById('btnQtyMinus');
  const btnQtyPlus = document.getElementById('btnQtyPlus');
  const qtyChips = document.querySelectorAll('.qty-chip');
  const groupSelect = document.getElementById('drawGroupSelect');
  const btnExportWinners = document.getElementById('btnExportWinners');

  populateLuckyDrawPrizeSelect();

  if (prizeSelect) {
    prizeSelect.addEventListener('change', () => {
      updateSelectedPrizePreview();
      const val = prizeSelect.value;
      const reward = state.rewards.find(r => r.name === val);
      if (reward && reward.group && reward.group !== 'ALL' && groupSelect) {
        const optionExists = Array.from(groupSelect.options).some(opt => opt.value === reward.group);
        if (optionExists) {
          groupSelect.value = reward.group;
          updateEligibleCandidateCount();
        }
      }
    });
  }

  if (btnQtyMinus && qtyInput) {
    btnQtyMinus.addEventListener('click', () => {
      let val = parseInt(qtyInput.value, 10) || 1;
      if (val > 1) {
        qtyInput.value = val - 1;
        updateActiveQtyChip(val - 1);
      }
    });
  }

  if (btnQtyPlus && qtyInput) {
    btnQtyPlus.addEventListener('click', () => {
      let val = parseInt(qtyInput.value, 10) || 1;
      qtyInput.value = val + 1;
      updateActiveQtyChip(val + 1);
    });
  }

  qtyChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const q = parseInt(chip.dataset.qty, 10);
      if (qtyInput) qtyInput.value = q;
      updateActiveQtyChip(q);
    });
  });

  function updateActiveQtyChip(q) {
    qtyChips.forEach(chip => {
      if (parseInt(chip.dataset.qty, 10) === q) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });
  }

  if (groupSelect) {
    groupSelect.addEventListener('change', () => {
      updateLuckyDrawStats();
    });
  }

  if (btnExportWinners) {
    btnExportWinners.addEventListener('click', exportLuckyWinnersExcel);
  }
}

function renderLuckyDrawView() {
  updateLuckyDrawStats();
}

function renderWinnersView() {
  updateLuckyDrawStats();
  renderLuckyWinnersTable();
}

function isMemberEligible(emp) {
  if (!emp) return false;
  const m = emp.Member;
  if (m === undefined || m === null) return false;
  const s = String(m).trim();
  return s !== '' && s !== '-' && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined';
}

function hasEmpNameText(empName) {
  if (empName === undefined || empName === null) return false;
  const s = String(empName).trim();
  return s !== '' && s !== '-' && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined';
}

function getEligibleCandidates(group = 'ALL') {
  return state.employees.filter(emp => {
    // 1. ตรวจสอบฟิวด์ Member ไม่ใช่ค่าว่าง หรือค่า null
    if (!isMemberEligible(emp)) return false;
    // 2. ฟิลด์ EmpName ต้องมีข้อความ (ไม่เท่ากับ - หรือค่าว่าง หรือค่า null ทั้งหมด)
    if (!hasEmpNameText(emp.EmpName)) return false;
    // 3. ยังไม่เคยได้รับรางวัลมาก่อนหน้านี้
    if (emp.RewardName && emp.RewardName !== '-' && String(emp.RewardName).trim() !== '') return false;
    // 4. กรองตามกลุ่ม
    if (group !== 'ALL' && emp.Group !== group) return false;
    return true;
  });
}

function updateLuckyDrawStats() {
  const drawnWinners = state.employees.filter(e => e.RewardName && e.RewardName !== '-' && String(e.RewardName).trim() !== '');
  const totalDrawn = drawnWinners.length;
  const claimedCount = drawnWinners.filter(e => e.RewardStatus === 'รับรางวัลแล้ว').length;
  const claimedPercent = totalDrawn > 0 ? Math.round((claimedCount / totalDrawn) * 100) : 0;

  const groupSelect = document.getElementById('drawGroupSelect');
  const targetGroup = groupSelect ? groupSelect.value : 'ALL';
  const eligibleCandidates = getEligibleCandidates(targetGroup);
  const totalEligibleAll = getEligibleCandidates('ALL').length;

  const kpiDrawn = document.getElementById('kpiDrawnTotal');
  const kpiEligible = document.getElementById('kpiEligibleCandidates');
  const kpiClaimed = document.getElementById('kpiClaimedTotal');
  const kpiClaimedHint = document.getElementById('kpiClaimedHint');
  const hintCandidate = document.getElementById('drawCandidateCountHint');
  const badgeDraw = document.getElementById('badgeDrawCount');
  const badgeWinners = document.getElementById('badgeWinnersCount');

  if (kpiDrawn) kpiDrawn.textContent = totalDrawn.toLocaleString();
  if (kpiEligible) kpiEligible.textContent = totalEligibleAll.toLocaleString();
  if (kpiClaimed) kpiClaimed.textContent = claimedCount.toLocaleString();
  if (kpiClaimedHint) kpiClaimedHint.textContent = `${claimedPercent}% รับของรางวัลแล้ว`;
  if (badgeDraw) badgeDraw.textContent = totalEligibleAll;
  if (badgeWinners) badgeWinners.textContent = totalDrawn;

  if (hintCandidate) {
    const grpText = targetGroup === 'ALL' ? 'ทุกกลุ่ม' : `กลุ่ม ${targetGroup}`;
    hintCandidate.textContent = `ผู้มีสิทธิ์ลุ้นรางวัลใน${grpText} (ลงทะเบียนแล้ว & มีชื่อ): ${eligibleCandidates.length} คน`;
  }
}

window.executeLuckyDraw = function() {
  if (isDrawRunning) return;

  const prizeSelect = document.getElementById('drawPrizeSelect');
  const customInput = document.getElementById('drawPrizeCustomInput');
  const qtyInput = document.getElementById('drawQuantityInput');
  const groupSelect = document.getElementById('drawGroupSelect');

  let prizeName = prizeSelect ? prizeSelect.value : 'ของรางวัลพิเศษ';
  if (prizeName === 'CUSTOM') {
    prizeName = customInput ? customInput.value.trim() : '';
  }
  if (!prizeName) {
    showToast("กรุณาระบุหรือเลือกชื่อของรางวัลก่อนทำการสุ่ม", "error");
    if (customInput) customInput.focus();
    return;
  }

  let qty = parseInt(qtyInput ? qtyInput.value : 1, 10);
  if (isNaN(qty) || qty <= 0) qty = 1;

  const targetGroup = groupSelect ? groupSelect.value : 'ALL';
  let eligible = getEligibleCandidates(targetGroup);

  if (eligible.length === 0) {
    showToast(`ไม่มีผู้มีสิทธิ์ลุ้นรางวัลใน${targetGroup === 'ALL' ? 'ระบบ' : 'กลุ่ม ' + targetGroup} (เงื่อนไข: ต้องลงทะเบียนแล้ว และมีชื่อพนักงาน EmpName)`, "error");
    return;
  }

  if (qty > eligible.length) {
    showToast(`มีผู้มีสิทธิ์ลุ้นรางวัลเพียง ${eligible.length} คน ระบบจะทำการสุ่มตามจำนวนที่มี`, "info");
    qty = eligible.length;
    if (qtyInput) qtyInput.value = qty;
  }

  // Start Animation
  isDrawRunning = true;
  const btnTrigger = document.getElementById('btnDrawTrigger');
  const stageStatus = document.getElementById('drawStageStatus');
  const idleState = document.getElementById('stageIdleState');
  const shufflingState = document.getElementById('stageShufflingState');
  const winnerState = document.getElementById('stageWinnerState');
  const shufflingEmpId = document.getElementById('shufflingEmpId');
  const shufflingEmpName = document.getElementById('shufflingEmpName');
  const shufflingEmpGroup = document.getElementById('shufflingEmpGroup');

  if (btnTrigger) {
    btnTrigger.disabled = true;
    btnTrigger.classList.add('is-animating');
  }
  if (stageStatus) stageStatus.textContent = '🎲 กำลังสุ่มจับรางวัล...';
  if (idleState) idleState.style.display = 'none';
  if (winnerState) winnerState.style.display = 'none';
  if (shufflingState) shufflingState.style.display = 'block';

  // Roulette Shuffle Effect
  let shuffleCount = 0;
  const shuffleTimer = setInterval(() => {
    const randomCand = eligible[Math.floor(Math.random() * eligible.length)];
    if (randomCand) {
      if (shufflingEmpId) shufflingEmpId.textContent = randomCand.EmployeeID;
      if (shufflingEmpName) shufflingEmpName.textContent = randomCand.EmpName || 'พนักงาน ttb';
      if (shufflingEmpGroup) shufflingEmpGroup.textContent = `กลุ่ม: ${randomCand.Group || '-'} | โซน: ${randomCand.EmpZone || '-'}`;
    }
    shuffleCount++;
  }, 65);

  setTimeout(() => {
    clearInterval(shuffleTimer);

    // Shuffle & pick winners using Fisher-Yates
    const shuffled = [...eligible];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const winners = shuffled.slice(0, qty);
    const now = new Date();
    const formattedDrawTime = `${now.getFullYear() + 543}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    // Update state & sync to Firestore
    winners.forEach(winner => {
      const targetInState = state.employees.find(e => e.EmployeeID === winner.EmployeeID);
      if (targetInState) {
        targetInState.RewardName = prizeName;
        targetInState.RewardTime = formattedDrawTime;
        targetInState.RewardDrawTime = formattedDrawTime;
        targetInState.RewardStatus = 'ยังไม่ได้รับ';
      }

      // Sync to Firestore
      if (state.db) {
        const docId = winner.id || winner.EmployeeID;
        state.db.collection(state.collectionName).doc(docId).set({
          RewardName: prizeName,
          RewardTime: formattedDrawTime,
          RewardDrawTime: formattedDrawTime,
          RewardStatus: 'ยังไม่ได้รับ'
        }, { merge: true }).catch(err => {
          console.warn("Firestore lucky draw sync warning:", err);
        });
      }
    });

    saveToLocalStorage(state.employees);
    onDataUpdated();

    // Render winner celebration cards
    if (shufflingState) shufflingState.style.display = 'none';
    if (winnerState) winnerState.style.display = 'block';
    if (stageStatus) stageStatus.textContent = `🎉 สุ่มสำเร็จ (${winners.length} ท่าน)`;

    const cardsContainer = document.getElementById('winnerCardsContainer');
    if (cardsContainer) {
      cardsContainer.innerHTML = winners.map((w, idx) => `
        <div class="winner-reveal-card animate-pop">
          <div class="winner-card-top">
            <span class="winner-rank-badge">🏆 ผู้โชคดี #${idx + 1}</span>
            <span class="badge-group badge-group-${w.Group || 'default'}">${w.Group || '-'}</span>
          </div>
          <div class="winner-card-body">
            <div class="winner-id">${w.EmployeeID}</div>
            <div class="winner-name">${w.EmpName || 'พนักงาน ttb'}</div>
            <div class="winner-details">${w.EmpPosition || '-'} &bull; ${w.EmpBranch || w.EmpZone || '-'}</div>
          </div>
          <div class="winner-card-footer">
            <div class="winner-prize-tag">
              <span class="prize-icon">🎁</span>
              <span class="prize-name">${prizeName}</span>
            </div>
            <div class="winner-time">${formattedDrawTime}</div>
          </div>
        </div>
      `).join('');
    }

    if (btnTrigger) {
      btnTrigger.disabled = false;
      btnTrigger.classList.remove('is-animating');
    }
    isDrawRunning = false;

    showToast(`🎉 ยินดีด้วยกับผู้ได้รับรางวัล "${prizeName}" จำนวน ${winners.length} ท่าน!`, "success");
  }, 1800);
};

function formatDrawDisplayTime(rawTime) {
  if (!rawTime || rawTime === '-' || String(rawTime).trim() === '') return '-';
  const str = String(rawTime).trim();
  if (str.includes('เวลา') || str.includes('น.')) return str;

  const match = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+)(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (match) {
    let year = parseInt(match[1], 10);
    if (year < 2400) year += 543;
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    const hours = match[4].padStart(2, '0');
    const minutes = match[5].padStart(2, '0');
    const seconds = match[6] ? match[6].padStart(2, '0') : null;
    const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const monthStr = thaiMonths[month - 1] || `${month}`;
    const secStr = seconds ? `:${seconds}` : '';
    return `${day} ${monthStr} ${year} เวลา ${hours}:${minutes}${secStr} น.`;
  }
  return str;
}

function renderLuckyWinnersTable() {
  const tbody = document.getElementById('luckyWinnersTableBody');
  if (!tbody) return;

  const getRewardOrder = (rewardName) => {
    if (!rewardName) return 9999;
    const clean = String(rewardName).trim().toLowerCase();
    const found = state.rewards.find(r => r.name && String(r.name).trim().toLowerCase() === clean);
    return found ? (Number(found.order) || 999) : 999;
  };

  const winners = state.employees
    .filter(e => e.RewardName && e.RewardName !== '-' && String(e.RewardName).trim() !== '')
    .sort((a, b) => {
      // 1. เรียงตามลำดับรายการของรางวัล (Order of Rewards)
      const orderA = getRewardOrder(a.RewardName);
      const orderB = getRewardOrder(b.RewardName);
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      const nameA = String(a.RewardName || '').trim();
      const nameB = String(b.RewardName || '').trim();
      if (nameA !== nameB) {
        return nameA.localeCompare(nameB);
      }
      // 2. รายชื่อผู้ได้รับรางวัล เรียงตามรหัสพนักงานจากน้อยไปมาก
      return String(a.EmployeeID || '').localeCompare(String(b.EmployeeID || ''), undefined, { numeric: true });
    });

  if (winners.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="td-empty">ยังไม่มีการสุ่มของรางวัล</td></tr>`;
    return;
  }

  tbody.innerHTML = winners.map((emp, idx) => {
    const rawDrawTime = emp.RewardDrawTime || emp.RewardTime || '-';
    const displayDrawTime = formatDrawDisplayTime(rawDrawTime);
    const isClaimed = emp.RewardStatus === 'รับรางวัลแล้ว';
    const statusBtn = isClaimed
      ? `<button type="button" class="btn-claim-toggle status-claimed" onclick="toggleRewardClaimStatus('${emp.EmployeeID}')" title="คลิกเพื่อเปลี่ยนเป็นยังไม่ได้รับ">
           <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
           <span>รับรางวัลแล้ว</span>
         </button>`
      : `<button type="button" class="btn-claim-toggle status-pending" onclick="toggleRewardClaimStatus('${emp.EmployeeID}')" title="คลิกเพื่อเปลี่ยนเป็นรับรางวัลแล้ว">
           <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
           <span>ยังไม่ได้รับ</span>
         </button>`;

    return `
      <tr>
        <td style="text-align: center;">${idx + 1}</td>
        <td class="td-time">${displayDrawTime}</td>
        <td><span class="badge-id">${emp.EmployeeID}</span></td>
        <td>${emp.EmpName || '-'}</td>
        <td>${emp.EmpPosition || '-'}</td>
        <td><span class="badge-group badge-group-${emp.Group || 'default'}">${emp.Group || '-'}</span></td>
        <td>${emp.EmpBranch || emp.EmpZone || '-'}</td>
        <td>
          <div class="prize-cell">
            <span class="prize-pill">🎁 ${emp.RewardName}</span>
          </div>
        </td>
        <td style="text-align: center;">${statusBtn}</td>
        <td style="text-align: center;">
          <button type="button" class="btn-icon-sm btn-revoke" onclick="revokeReward('${emp.EmployeeID}')" title="ยกเลิกผลรางวัลรายนี้">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.toggleRewardClaimStatus = function(empId) {
  const strId = String(empId).trim();
  const target = state.employees.find(e => String(e.EmployeeID).trim() === strId || String(e.id || '').trim() === strId);
  if (!target) return;

  const currentStatus = target.RewardStatus || 'ยังไม่ได้รับ';
  const newStatus = currentStatus === 'รับรางวัลแล้ว' ? 'ยังไม่ได้รับ' : 'รับรางวัลแล้ว';
  target.RewardStatus = newStatus;

  let claimedTimeStr = null;
  if (newStatus === 'รับรางวัลแล้ว') {
    const now = new Date();
    const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    claimedTimeStr = `${now.getDate()} ${thaiMonths[now.getMonth()]} ${now.getFullYear() + 543} เวลา ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} น.`;
  }
  target.RewardClaimedTime = claimedTimeStr;

  saveToLocalStorage(state.employees);
  onDataUpdated();
  showToast(`อัปเดตสถานะรางวัลรหัส ${strId} เป็น "${newStatus}" สำเร็จ`, "success");

  if (state.db) {
    const docId = target.id || strId;
    state.db.collection(state.collectionName).doc(docId).set({
      RewardStatus: newStatus,
      RewardClaimedTime: claimedTimeStr
    }, { merge: true }).catch(err => {
      console.warn("Firestore update reward status error:", err);
    });
  }
};

window.revokeReward = function(empId) {
  const strId = String(empId).trim();
  const target = state.employees.find(e => String(e.EmployeeID).trim() === strId || String(e.id || '').trim() === strId);
  if (!target) return;

  if (!confirm(`ต้องการยกเลิกผลรางวัล "${target.RewardName}" ของพนักงานรหัส ${strId} (${target.EmpName || ''}) ใช่หรือไม่?\n(พนักงานจะกลับมามีสิทธิ์ลุ้นรางวัลอีกครั้ง)`)) {
    return;
  }

  target.RewardName = null;
  target.RewardTime = null;
  target.RewardDrawTime = null;
  target.RewardStatus = null;
  target.RewardClaimedTime = null;
  target.RewardOwner = null;
  target.RewardExecutive = null;
  target.RewardId = null;
  target.RewardGroup = null;

  saveToLocalStorage(state.employees);
  onDataUpdated();
  showToast(`ยกเลิกผลรางวัลของรหัส ${strId} เรียบร้อยแล้ว`, "success");

  if (state.db) {
    const docId = target.id || strId;
    state.db.collection(state.collectionName).doc(docId).set({
      RewardName: null,
      RewardTime: null,
      RewardDrawTime: null,
      RewardStatus: null,
      RewardClaimedTime: null,
      RewardOwner: null,
      RewardExecutive: null,
      RewardId: null,
      RewardGroup: null
    }, { merge: true }).catch(err => {
      console.warn("Firestore revoke reward error:", err);
    });
  }
};

function exportLuckyWinnersExcel() {
  if (typeof XLSX === 'undefined') {
    showToast("ไม่พบโมดูล XLSX", "error");
    return;
  }

  const winners = state.employees
    .filter(e => e.RewardName && e.RewardName !== '-' && String(e.RewardName).trim() !== '')
    .sort((a, b) => {
      const timeA = String(a.RewardDrawTime || a.RewardTime || '');
      const timeB = String(b.RewardDrawTime || b.RewardTime || '');
      return timeB.localeCompare(timeA);
    });

  if (winners.length === 0) {
    showToast("ยังไม่มีข้อมูลผู้ได้รับรางวัลให้ส่งออก", "error");
    return;
  }

  const data = winners.map((w, idx) => ({
    "ลำดับ": idx + 1,
    "เวลาที่สุ่ม": formatDrawDisplayTime(w.RewardDrawTime || w.RewardTime),
    "EmployeeID": w.EmployeeID,
    "ชื่อ - นามสกุล": w.EmpName || "",
    "ตำแหน่ง": w.EmpPosition || "",
    "กลุ่ม": w.Group || "",
    "Member": w.Member || "",
    "สาขา": w.EmpBranch || "",
    "โซน": w.EmpZone || "",
    "ชื่อรางวัลที่ได้รับ": w.RewardName || "",
    "สถานะการรับรางวัล": w.RewardStatus || "ยังไม่ได้รับ",
    "เวลาที่ยืนยันรับรางวัล": w.RewardClaimedTime || "-"
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lucky_Draw_Winners");
  XLSX.writeFile(wb, `AL_Lucky_Winners_${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast("ส่งออกรายชื่อผู้ได้รับรางวัล (.xlsx) สำเร็จ", "success");
}

// =============================================================================
// RESET WINNERS (ลบรายชื่อผู้ได้รับรางวัลทั้งหมด)
// =============================================================================
function initResetWinnersModal() {
  const btnResetWinners = document.getElementById('btnResetWinners');
  const modalReset = document.getElementById('modalResetWinnersConfirm');
  const btnCloseReset = document.getElementById('btnCloseResetWinnersModal');
  const btnCancelReset = document.getElementById('btnCancelResetWinners');
  const btnConfirmReset = document.getElementById('btnConfirmResetWinners');
  const preview = document.getElementById('resetWinnersPreview');

  const closeResetModal = () => {
    if (modalReset) {
      modalReset.classList.remove('is-active');
      document.body.style.overflow = '';
    }
  };

  if (btnCloseReset) btnCloseReset.addEventListener('click', closeResetModal);
  if (btnCancelReset) btnCancelReset.addEventListener('click', closeResetModal);
  if (modalReset) {
    modalReset.addEventListener('click', (e) => {
      if (e.target === modalReset) closeResetModal();
    });
  }

  if (btnResetWinners) {
    btnResetWinners.addEventListener('click', () => {
      const winners = state.employees.filter(e => e.RewardName && e.RewardName !== '-' && String(e.RewardName).trim() !== '');

      if (winners.length === 0) {
        showToast("ยังไม่มีรายชื่อผู้ได้รับรางวัลในระบบที่ต้อง Reset", "info");
        return;
      }

      const claimedCount = winners.filter(e => e.RewardStatus === 'รับรางวัลแล้ว').length;
      const pendingCount = winners.length - claimedCount;

      // Group counts by reward name
      const prizeCounts = {};
      winners.forEach(w => {
        const p = w.RewardName || 'รางวัลทั่วไป';
        prizeCounts[p] = (prizeCounts[p] || 0) + 1;
      });
      const prizeSummaryList = Object.entries(prizeCounts)
        .map(([pName, count]) => `${pName} (${count})`)
        .slice(0, 5)
        .join(', ');
      const extraPrizes = Object.keys(prizeCounts).length > 5 ? ` และอีก ${Object.keys(prizeCounts).length - 5} รางวัล` : '';

      if (preview) {
        preview.innerHTML = `
          <div class="del-thumb" style="font-size: 1.5rem;">🏆</div>
          <div class="del-info">
            <div class="del-name">พบผู้ได้รับรางวัลทั้งหมด: <strong>${winners.length}</strong> ท่าน</div>
            <div class="del-meta" style="color: var(--color-text-muted); font-size: 13px; line-height: 1.4;">
              <span>รับรางวัลแล้ว ${claimedCount} ท่าน &bull; ยังไม่ได้รับ ${pendingCount} ท่าน</span>
              <div style="margin-top: 4px; font-size: 12px; color: var(--color-text-sub); word-break: break-word;">
                ${escapeHtml(prizeSummaryList + extraPrizes)}
              </div>
            </div>
          </div>
        `;
      }

      if (modalReset) {
        modalReset.classList.add('is-active');
        document.body.style.overflow = 'hidden';
      }
    });
  }

  if (btnConfirmReset) {
    btnConfirmReset.addEventListener('click', async () => {
      const winners = state.employees.filter(e => e.RewardName && e.RewardName !== '-' && String(e.RewardName).trim() !== '');

      if (winners.length === 0) {
        closeResetModal();
        showToast("ไม่มีรายชื่อผู้ได้รับรางวัลที่ต้อง Reset", "info");
        return;
      }

      try {
        btnConfirmReset.disabled = true;
        btnConfirmReset.textContent = 'กำลังลบรายชื่อผู้ได้รับรางวัล...';

        // 1. นำชื่อของรางวัลและข้อมูลผลการสุ่มออกจากพนักงานทุกคน
        winners.forEach(w => {
          w.RewardName = null;
          w.RewardTime = null;
          w.RewardDrawTime = null;
          w.RewardStatus = null;
          w.RewardClaimedTime = null;
          w.RewardOwner = null;
          w.RewardExecutive = null;
          w.RewardId = null;
          w.RewardGroup = null;
        });

        // 2. Batch update ใน Firebase Firestore (หากมีการเชื่อมต่อ)
        if (state.db) {
          const chunkSize = 400;
          for (let i = 0; i < winners.length; i += chunkSize) {
            const chunk = winners.slice(i, i + chunkSize);
            const batch = state.db.batch();
            chunk.forEach(w => {
              const docId = w.id || String(w.EmployeeID);
              const ref = state.db.collection(state.collectionName).doc(docId);
              batch.set(ref, {
                RewardName: null,
                RewardTime: null,
                RewardDrawTime: null,
                RewardStatus: null,
                RewardClaimedTime: null,
                RewardOwner: null,
                RewardExecutive: null,
                RewardId: null,
                RewardGroup: null
              }, { merge: true });
            });
            await batch.commit();
          }
        }

        // 3. บันทึกลง LocalStorage และ BroadcastSync ไปยังหน้าสุ่มรางวัล (random.html) แบบเรียลไทม์
        saveToLocalStorage(state.employees);

        // 4. อัปเดตตารางและ KPI ในหน้า Admin
        onDataUpdated();

        closeResetModal();
        showToast(`Reset และลบรายชื่อผู้ได้รับรางวัลทั้งหมด (${winners.length} ท่าน) สำเร็จ`, "success");
      } catch (err) {
        console.error("Error resetting winners:", err);
        showToast("เกิดข้อผิดพลาดในการ Reset ผู้รับรางวัล กรุณาลองใหม่อีกครั้ง", "error");
      } finally {
        btnConfirmReset.disabled = false;
        btnConfirmReset.textContent = 'ยืนยันการลบรายชื่อผู้ได้รับรางวัล';
      }
    });
  }
}

// =============================================================================
// MODAL: CONFIRM CANCEL REGISTRATION (ยกเลิกการลงทะเบียน / ลบรายการ Guest)
// =============================================================================
let targetCancelRegEmpId = null;

function initCancelRegModal() {
  const modal = document.getElementById('modalCancelRegConfirm');
  const btnClose = document.getElementById('btnCloseCancelRegModal');
  const btnDismiss = document.getElementById('btnDismissCancelReg');
  const btnConfirm = document.getElementById('btnConfirmDeleteReg');

  const closeModal = () => {
    if (modal) modal.classList.remove('is-active');
    document.body.style.overflow = '';
    targetCancelRegEmpId = null;
  };

  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnDismiss) btnDismiss.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      if (!targetCancelRegEmpId) {
        closeModal();
        return;
      }

      const empId = targetCancelRegEmpId;
      const targetEmp = state.employees.find(e => String(e.EmployeeID).trim() === String(empId).trim());
      if (!targetEmp) {
        closeModal();
        showToast("ไม่พบรายการที่ต้องการลบในระบบ", "warning");
        return;
      }

      try {
        btnConfirm.disabled = true;
        btnConfirm.textContent = 'กำลังลบรายการ...';

        // 1. Delete from Firestore if connected
        if (state.db) {
          try {
            const docId = targetEmp.id || String(targetEmp.EmployeeID).trim();
            await state.db.collection(state.collectionName).doc(docId).delete();
          } catch (err) {
            console.warn("Firestore delete guest employee error:", err);
          }
        }

        // 2. Remove from state.employees
        const idx = state.employees.findIndex(e => String(e.EmployeeID).trim() === String(empId).trim());
        if (idx !== -1) {
          state.employees.splice(idx, 1);
        }

        // 3. Save to LocalStorage and broadcast
        saveToLocalStorage(state.employees);

        // 4. Update UI
        closeModal();
        onDataUpdated();
        showToast(`ยกเลิกการลงทะเบียนและลบรายการรหัส ${empId} สำเร็จ`, "success");
      } catch (err) {
        console.error("Error canceling registration:", err);
        showToast("เกิดข้อผิดพลาดในการลบรายการ กรุณาลองใหม่อีกครั้ง", "error");
      } finally {
        btnConfirm.disabled = false;
        btnConfirm.textContent = 'ยืนยันการลบรายการ';
      }
    });
  }
}

window.openCancelRegModal = function(empId) {
  targetCancelRegEmpId = empId;
  const targetEmp = state.employees.find(e => String(e.EmployeeID).trim() === String(empId).trim());
  const modal = document.getElementById('modalCancelRegConfirm');
  const preview = document.getElementById('cancelRegPreview');

  if (preview && targetEmp) {
    preview.innerHTML = `
      <div style="background: #ffffff; border: 1.5px solid #fee2e2; border-radius: 8px; padding: 14px 16px; text-align: left; display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem;">
          <span style="color: #64748b; font-weight: 500;">รหัสพนักงาน:</span>
          <span style="font-weight: 700; color: #0f172a; font-size: 0.95rem;">${escapeHtml(String(targetEmp.EmployeeID || '-'))}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem;">
          <span style="color: #64748b; font-weight: 500;">ชื่อ - นามสกุล:</span>
          <span style="font-weight: 600; color: #dc2626;">Guest (ไม่มีชื่อในฐานข้อมูล)</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.86rem;">
          <span style="color: #64748b; font-weight: 500;">เวลาที่ลงทะเบียน:</span>
          <span style="font-weight: 600; color: #334155;">${escapeHtml(String(targetEmp.registeredAt || '-'))}</span>
        </div>
      </div>
    `;
  }

  if (modal) {
    modal.classList.add('is-active');
    document.body.style.overflow = 'hidden';
  }
};

// =============================================================================
// MODAL: CONFIRM RESET REGISTRATION (ยืนยันการ Reset ข้อมูลการลงทะเบียนทั้งหมด)
// =============================================================================
function initResetRegModal() {
  const modal = document.getElementById('modalResetRegConfirm');
  const btnOpen = document.getElementById('btnOpenResetRegModal');
  const btnClose = document.getElementById('btnCloseResetRegModal');
  const btnCancel = document.getElementById('btnCancelResetReg');
  const btnConfirm = document.getElementById('btnConfirmResetReg');
  const preview = document.getElementById('resetRegPreview');

  const closeResetRegModal = () => {
    if (modal) modal.classList.remove('is-active');
    document.body.style.overflow = '';
  };

  if (btnClose) btnClose.addEventListener('click', closeResetRegModal);
  if (btnCancel) btnCancel.addEventListener('click', closeResetRegModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeResetRegModal();
    });
  }

  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      const registered = state.employees.filter(e => e.isRegistered);
      const total = state.employees.length;

      if (registered.length === 0) {
        showToast("ยังไม่มีข้อมูลพนักงานที่ลงทะเบียนในระบบ", "info");
        return;
      }

      if (preview) {
        preview.innerHTML = `
          <div class="del-thumb" style="font-size: 1.5rem;">📋</div>
          <div class="del-info">
            <div class="del-name">พบผู้ลงทะเบียนแล้วทั้งหมด: <strong>${registered.length.toLocaleString()}</strong> / ${total.toLocaleString()} ท่าน</div>
            <div class="del-meta" style="color: var(--color-text-muted); font-size: 13px; line-height: 1.4; margin-top: 4px;">
              <span>ข้อมูลการเช็กอินและเวลาที่บันทึกไว้จะถูกล้างออกทั้งหมด</span>
            </div>
          </div>
        `;
      }

      if (modal) {
        modal.classList.add('is-active');
        document.body.style.overflow = 'hidden';
      }
    });
  }

  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      const registered = state.employees.filter(e => e.isRegistered);

      if (registered.length === 0) {
        closeResetRegModal();
        showToast("ไม่มีข้อมูลการลงทะเบียนที่ต้อง Reset", "info");
        return;
      }

      try {
        btnConfirm.disabled = true;
        btnConfirm.textContent = 'กำลัง Reset ข้อมูลการลงทะเบียน...';

        // 1. Reset registration in state.employees
        state.employees.forEach(e => {
          e.isRegistered = false;
          e.registeredAt = null;
        });

        // 2. Batch update in Firebase Firestore if connected
        if (state.db) {
          const chunkSize = 400;
          for (let i = 0; i < state.employees.length; i += chunkSize) {
            const chunk = state.employees.slice(i, i + chunkSize);
            const batch = state.db.batch();
            chunk.forEach(emp => {
              const docId = emp.id || String(emp.EmployeeID);
              const ref = state.db.collection(state.collectionName).doc(docId);
              batch.set(ref, {
                isRegistered: false,
                registeredAt: null
              }, { merge: true });
            });
            await batch.commit();
          }
        }

        // 3. Save to LocalStorage and broadcast sync
        saveToLocalStorage(state.employees);

        // 4. Update UI
        onDataUpdated();

        closeResetRegModal();
        showToast(`Reset การลงทะเบียนทั้งหมด (${registered.length.toLocaleString()} ท่าน) สำเร็จ`, "success");
      } catch (err) {
        console.error("Error resetting registration:", err);
        showToast("เกิดข้อผิดพลาดในการ Reset การลงทะเบียน กรุณาลองใหม่อีกครั้ง", "error");
      } finally {
        btnConfirm.disabled = false;
        btnConfirm.textContent = 'ยืนยันการ Reset การลงทะเบียน';
      }
    });
  }
}

// =============================================================================
// MODAL: CONFIRM DELETE ALL EMPLOYEES (ยืนยันการลบข้อมูลพนักงานทั้งหมด)
// =============================================================================
function initDeleteAllEmpModal() {
  const modal = document.getElementById('modalDeleteAllEmpConfirm');
  const btnOpen = document.getElementById('btnOpenDeleteAllEmpModal');
  const btnClose = document.getElementById('btnCloseDeleteAllEmpModal');
  const btnCancel = document.getElementById('btnCancelDeleteAllEmp');
  const btnConfirm = document.getElementById('btnConfirmDeleteAllEmp');
  const preview = document.getElementById('deleteAllEmpPreview');
  const confirmInput = document.getElementById('confirmDeleteMemberInput');
  const confirmHint = document.getElementById('confirmDeleteMemberHint');

  const closeDeleteAllModal = () => {
    if (modal) modal.classList.remove('is-active');
    document.body.style.overflow = '';
    if (confirmInput) {
      confirmInput.value = '';
      confirmInput.disabled = false;
    }
    if (btnConfirm) {
      btnConfirm.disabled = true;
      btnConfirm.textContent = 'ลบข้อมูลพนักงานทั้งหมด';
    }
  };

  if (btnClose) btnClose.addEventListener('click', closeDeleteAllModal);
  if (btnCancel) btnCancel.addEventListener('click', closeDeleteAllModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeDeleteAllModal();
    });
  }

  // Monitor typing of "Delete Member"
  if (confirmInput) {
    confirmInput.addEventListener('input', () => {
      const val = confirmInput.value.trim();
      const isMatch = val === 'Delete Member' || val.toLowerCase() === 'delete member';
      if (isMatch) {
        btnConfirm.disabled = false;
        if (confirmHint) {
          confirmHint.innerHTML = '<span style="color: #16a34a; font-weight: 600;">✓ ข้อความถูกต้อง สามารถกดปุ่มลบข้อมูลได้</span>';
        }
      } else {
        btnConfirm.disabled = true;
        if (confirmHint) {
          confirmHint.innerHTML = 'พิมพ์คำว่า <strong>Delete Member</strong> เพื่อเปิดใช้งานปุ่ม';
        }
      }
    });

    // Enter key triggers click if enabled
    confirmInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !btnConfirm.disabled) {
        btnConfirm.click();
      }
    });
  }

  // Open modal click
  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      const total = state.employees.length;
      if (total === 0) {
        showToast("ยังไม่มีข้อมูลพนักงานในระบบให้ลบ", "info");
        return;
      }

      if (confirmInput) {
        confirmInput.value = '';
        confirmInput.disabled = false;
      }
      if (confirmHint) {
        confirmHint.innerHTML = 'พิมพ์คำว่า <strong>Delete Member</strong> เพื่อเปิดใช้งานปุ่ม';
      }
      if (btnConfirm) {
        btnConfirm.disabled = true;
        btnConfirm.textContent = 'ลบข้อมูลพนักงานทั้งหมด';
      }

      const registeredCount = state.employees.filter(e => e.isRegistered).length;
      if (preview) {
        preview.innerHTML = `
          <div class="del-thumb" style="font-size: 1.5rem; background: #fee2e2; color: #dc2626;">🗑️</div>
          <div class="del-info">
            <div class="del-name">พบข้อมูลพนักงานทั้งหมด: <strong>${total.toLocaleString()}</strong> ท่าน</div>
            <div class="del-meta" style="color: var(--color-text-muted); font-size: 13px; line-height: 1.4; margin-top: 4px;">
              <span>ลงทะเบียนแล้ว ${registeredCount.toLocaleString()} ท่าน &bull; ตาราง AL_Employee จะถูกล้างข้อมูลออกทั้งหมด</span>
            </div>
          </div>
        `;
      }

      if (modal) {
        modal.classList.add('is-active');
        document.body.style.overflow = 'hidden';
        setTimeout(() => {
          if (confirmInput) confirmInput.focus();
        }, 100);
      }
    });
  }

  // Confirm delete
  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      if (btnConfirm.disabled) return;

      const totalToDelete = state.employees.length;
      if (totalToDelete === 0) {
        closeDeleteAllModal();
        showToast("ไม่มีข้อมูลพนักงานที่ต้องลบ", "info");
        return;
      }

      try {
        // Disabled immediately when clicked
        btnConfirm.disabled = true;
        if (confirmInput) confirmInput.disabled = true;
        btnConfirm.textContent = 'กำลังลบข้อมูลพนักงาน...';

        // 1. Batch delete in Firebase Firestore if connected
        if (state.db) {
          try {
            const snapshot = await state.db.collection(state.collectionName).get();
            if (!snapshot.empty) {
              const docs = snapshot.docs;
              const chunkSize = 400;
              for (let i = 0; i < docs.length; i += chunkSize) {
                const chunk = docs.slice(i, i + chunkSize);
                const batch = state.db.batch();
                chunk.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
              }
            }
          } catch (err) {
            console.error("Firestore batch delete employees error:", err);
          }
        }

        // 2. Clear state.employees array
        state.employees = [];

        // 3. Clear LocalStorage and broadcast real-time sync
        saveToLocalStorage([]);

        // 4. Update UI
        onDataUpdated();

        // 5. Close lightbox
        closeDeleteAllModal();
        showToast(`ลบข้อมูลพนักงานทั้งหมด (${totalToDelete.toLocaleString()} ท่าน) เรียบร้อยแล้ว`, "success");
      } catch (err) {
        console.error("Delete all employees error:", err);
        showToast("เกิดข้อผิดพลาดในการลบข้อมูล กรุณาลองใหม่อีกครั้ง", "error");
        btnConfirm.disabled = false;
        if (confirmInput) confirmInput.disabled = false;
        btnConfirm.textContent = 'ลบข้อมูลพนักงานทั้งหมด';
      }
    });
  }
}

// =============================================================================
// TAB: MEDALS DASHBOARD (การรับเหรียญรางวัลพนักงาน)
// =============================================================================
function renderMedalsView() {
  const eligibleEmployees = state.employees.filter(e => e.Member && String(e.Member).trim() !== '' && String(e.Member).trim() !== '-' && String(e.Member).toLowerCase() !== 'null');
  
  const totalEligible = eligibleEmployees.length;
  const claimedEmployees = eligibleEmployees.filter(e => e.MemberDate && String(e.MemberDate).trim() !== '' && String(e.MemberDate).trim() !== '-' && String(e.MemberDate).toLowerCase() !== 'null');
  const claimedCount = claimedEmployees.length;
  const pendingCount = totalEligible - claimedCount;
  const claimPercent = totalEligible > 0 ? ((claimedCount / totalEligible) * 100).toFixed(1) : '0';

  // 1. Update 4 KPI Cards
  const kpiTotal = document.getElementById('kpiMedalTotal');
  const kpiClaimed = document.getElementById('kpiMedalClaimed');
  const kpiPending = document.getElementById('kpiMedalPending');
  const kpiPercent = document.getElementById('kpiMedalPercent');
  const badgeMedals = document.getElementById('badgeMedalsCount');

  if (kpiTotal) kpiTotal.textContent = totalEligible.toLocaleString();
  if (kpiClaimed) kpiClaimed.textContent = claimedCount.toLocaleString();
  if (kpiPending) kpiPending.textContent = pendingCount.toLocaleString();
  if (kpiPercent) kpiPercent.textContent = `${claimPercent}%`;
  if (badgeMedals) badgeMedals.textContent = `${claimedCount}/${totalEligible}`;

  // 2. Render Two 50% Columns: ปี 2025 และ ปี 2026
  renderMedalYearColumn('2025', eligibleEmployees.filter(e => String(e.Member).includes('2025')));
  renderMedalYearColumn('2026', eligibleEmployees.filter(e => String(e.Member).includes('2026')));
}

function renderMedalYearColumn(year, empList) {
  const grid = document.getElementById(`gridMedal${year}`);
  const statElem = document.getElementById(`statMedal${year}`);
  const progressPct = document.getElementById(`progressPct${year}`);
  const progressBar = document.getElementById(`progressBar${year}`);
  const progressCount = document.getElementById(`progressCount${year}`);
  if (!grid) return;

  // Calculate year totals BEFORE search filter so progress bar accurately reflects overall status
  const total = empList.length;
  const claimed = empList.filter(e => e.MemberDate && String(e.MemberDate).trim() !== '' && String(e.MemberDate).trim() !== '-' && String(e.MemberDate).toLowerCase() !== 'null').length;
  const percent = total > 0 ? Math.round((claimed / total) * 100) : 0;

  if (statElem) {
    statElem.textContent = `รับเหรียญแล้ว ${claimed} จาก ${total} ท่าน (${percent}%)`;
  }
  if (progressPct) {
    progressPct.textContent = `${percent}%`;
  }
  if (progressBar) {
    progressBar.style.width = `${percent}%`;
  }
  if (progressCount) {
    progressCount.textContent = `${claimed} / ${total} ท่าน`;
  }

  // Filter by medalSearchQuery if typed
  const query = (state.medalSearchQuery || '').toLowerCase();
  let displayList = empList;
  if (query) {
    displayList = empList.filter(emp => {
      const idMatch = String(emp.EmployeeID || '').toLowerCase().includes(query);
      const nameMatch = String(emp.EmpName || '').toLowerCase().includes(query);
      const branchMatch = String(emp.EmpBranch || '').toLowerCase().includes(query);
      const zoneMatch = String(emp.EmpZone || '').toLowerCase().includes(query);
      return idMatch || nameMatch || branchMatch || zoneMatch;
    });
  }

  // Sort by EmployeeID
  displayList.sort((a, b) => {
    const numA = Number(a.EmployeeID);
    const numB = Number(b.EmployeeID);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a.EmployeeID || '').localeCompare(String(b.EmployeeID || ''), 'th', { numeric: true });
  });

  if (displayList.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--color-text-muted); padding: 24px;">${query ? 'ไม่พบข้อมูลที่ค้นหา' : `ไม่พบข้อมูลพนักงานสำหรับปี ${year}`}</div>`;
    return;
  }

  grid.innerHTML = displayList.map(emp => {
    const isClaimed = !!(emp.MemberDate && String(emp.MemberDate).trim() !== '' && String(emp.MemberDate).trim() !== '-' && String(emp.MemberDate).toLowerCase() !== 'null');
    const empId = escapeHtml(emp.EmployeeID);

    return `
      <div class="medal-emp-box ${isClaimed ? 'is-claimed' : ''}" 
           id="empMedalBox_${empId}" 
           title="${isClaimed ? 'ชี้เมาส์เพื่อยกเลิกการรับรางวัล' : 'ชี้เมาส์เพื่อบันทึกรับรางวัล'} (รหัส ${empId})" 
           onclick="toggleMedalActionBox('${empId}', event)">
        <div class="emp-box-data-row">
          <span class="emp-box-id">${empId}</span>
          <span class="badge-group badge-group-${escapeHtml(emp.Group || 'default')}">${escapeHtml(emp.Group || '-')}</span>
          <span class="emp-box-name" title="${escapeHtml(emp.EmpName || '')}">${escapeHtml(emp.EmpName || 'ไม่ระบุชื่อ')}</span>
          <span class="emp-box-divider">&bull;</span>
          <span class="emp-box-meta" title="${escapeHtml(emp.EmpPosition || '-')} &bull; ${escapeHtml(emp.EmpBranch || emp.EmpZone || '-')}">${escapeHtml(emp.EmpPosition || '-')} &bull; ${escapeHtml(emp.EmpBranch || emp.EmpZone || '-')}</span>
        </div>
        <div class="emp-box-action-wrap">
          ${isClaimed ? `
            <button type="button" class="btn-medal-action btn-cancel-red" onclick="executeMedalAction('${empId}', false, event)" title="คลิกเพื่อยกเลิกการรับรางวัล">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              <span>ยกเลิกการรับรางวัล</span>
            </button>
          ` : `
            <button type="button" class="btn-medal-action btn-claim-green" onclick="executeMedalAction('${empId}', true, event)" title="คลิกเพื่อบันทึกการรับรางวัล">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>คลิกรับรางวัล</span>
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

window.toggleMedalActionBox = function(empId, event) {
  if (event && event.target.closest('.btn-medal-action')) return;

  const targetBox = document.getElementById(`empMedalBox_${empId}`);
  if (!targetBox) return;

  const isAlreadyActive = targetBox.classList.contains('has-action-visible');

  // Close any open action button across all boxes
  document.querySelectorAll('.medal-emp-box.has-action-visible').forEach(box => {
    box.classList.remove('has-action-visible');
  });

  // If wasn't active, open it now
  if (!isAlreadyActive) {
    targetBox.classList.add('has-action-visible');
  }
};

window.executeMedalAction = function(empId, isClaiming, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  const strId = String(empId).trim();
  const target = state.employees.find(e => String(e.EmployeeID).trim() === strId || String(e.id || '').trim() === strId);
  if (!target) return;

  let newMemberDate = null;
  if (isClaiming) {
    const now = new Date();
    newMemberDate = `${now.getFullYear() + 543}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  }

  target.MemberDate = newMemberDate;

  saveToLocalStorage(state.employees);
  onDataUpdated();

  showToast(`${isClaiming ? 'บันทึกรับเหรียญรางวัล' : 'ยกเลิกการรับรางวัล'} รหัส ${strId} สำเร็จ`, "success");

  // Sync to Firestore
  if (state.db) {
    const docId = target.id || strId;
    state.db.collection(state.collectionName).doc(docId).set({
      MemberDate: newMemberDate
    }, { merge: true }).catch(err => {
      console.warn("Firestore sync error:", err);
    });
  }
};

window.toggleMedalClaimAdmin = function(empId) {
  const strId = String(empId).trim();
  const target = state.employees.find(e => String(e.EmployeeID).trim() === strId || String(e.id || '').trim() === strId);
  if (!target) return;
  const hasClaimed = !!(target.MemberDate && String(target.MemberDate).trim() !== '' && String(target.MemberDate).trim() !== '-' && String(target.MemberDate).toLowerCase() !== 'null');
  executeMedalAction(empId, !hasClaimed);
};

function exportMedalsExcel() {
  if (typeof XLSX === 'undefined') return;

  const eligibleEmployees = state.employees.filter(e => e.Member && String(e.Member).trim() !== '' && String(e.Member).trim() !== '-' && String(e.Member).toLowerCase() !== 'null');

  // Sort by Member year, then EmployeeID
  eligibleEmployees.sort((a, b) => {
    const memCmp = String(a.Member || '').localeCompare(String(b.Member || ''));
    if (memCmp !== 0) return memCmp;
    const numA = Number(a.EmployeeID);
    const numB = Number(b.EmployeeID);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a.EmployeeID || '').localeCompare(String(b.EmployeeID || ''), 'th', { numeric: true });
  });

  const data = eligibleEmployees.map((e, idx) => ({
    "ลำดับ": idx + 1,
    "EmployeeID": e.EmployeeID,
    "ชื่อ - นามสกุล": e.EmpName || "",
    "ตำแหน่ง": e.EmpPosition || "",
    "สาขา": e.EmpBranch || "",
    "โซน": e.EmpZone || "",
    "กลุ่ม": e.Group || "",
    "ปีเหรียญรางวัล (Member)": e.Member || "",
    "สถานะรับเหรียญ": e.MemberDate ? "รับเหรียญแล้ว" : "ยังไม่ได้รับ",
    "เวลาที่รับเหรียญ (MemberDate)": e.MemberDate || "-"
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Medal_Recipients");
  XLSX.writeFile(wb, `AL_Medal_Recipients_${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast("ส่งออกข้อมูลการรับเหรียญรางวัลสำเร็จ", "success");
}




