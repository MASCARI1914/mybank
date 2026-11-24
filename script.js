/* ================= SUPABASE INITIALIZATION ================= */
const SUPABASE_URL = 'https://grwymznaxkqfoehysxjc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ejP6v4ml6GQg8BnZ6c1RVw_VdA9TUAX';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ================= STATE ================= */
let currentUser = null;
let currentUserId = null;
let transactions = [];
let budgetLimit = 1066.00;
let initialBalance = 0.00;
let cycleStartDay = 12;
let tempSelectedCycleDay = 12;
let currentType = 'expense';
let isHidden = false;
let selectedCat = 'all';

// Ανάλυση: 'cycle' (Κύκλος) ή 'month' (Ημερολογιακός Μήνας)
let analysisMode = 'cycle'; 
// Τύπος γραφήματος: 'doughnut' (Πίτα) ή 'bar' (Ράβδος)
let chartType = 'doughnut';
let expensesChartInstance = null;

/* ================= TOAST NOTIFICATION ================= */
let toastTimeout;
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toastNotification');
  const msgEl = document.getElementById('toastMsg');
  if (!toast || !msgEl) return;

  msgEl.innerText = message;
  toast.classList.add('active');

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('active');
  }, duration);
}

/* ================= AUTHENTICATION ================= */
function togglePasswordVisibility() {
  const pwInput = document.getElementById('authPassword');
  const eyeOpen = document.getElementById('pwEyeOpen');
  const eyeClosed = document.getElementById('pwEyeClosed');

  if (!pwInput || !eyeOpen || !eyeClosed) return;

  if (pwInput.type === 'password') {
    pwInput.type = 'text';
    eyeOpen.style.display = 'none';
    eyeClosed.style.display = 'block';
  } else {
    pwInput.type = 'password';
    eyeOpen.style.display = 'block';
    eyeClosed.style.display = 'none';
  }
}

function showAuthMsg(msg, isSuccess = false) {
  const el = document.getElementById('authMessage');
  if (!el) return;
  el.className = 'auth-msg ' + (isSuccess ? 'success' : 'error');
  el.innerText = msg;
}

function formatAuthEmail(username) {
  return `${username.toLowerCase().trim()}@mybank.local`;
}

async function handleLogin() {
  const u = document.getElementById('authUsername').value.trim().toLowerCase();
  const p = document.getElementById('authPassword').value;

  if (!u || !p) {
    showAuthMsg('Συμπληρώστε όνομα χρήστη και κωδικό.');
    return;
  }

  showAuthMsg('Σύνδεση...');
  const email = formatAuthEmail(u);

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: p
  });

  if (error) {
    showAuthMsg('Λανθασμένο όνομα χρήστη ή κωδικός.');
    return;
  }

  currentUser = u;
  currentUserId = data.user.id;
  await initUserSession();
}

async function handleRegister() {
  const u = document.getElementById('authUsername').value.trim().toLowerCase();
  const p = document.getElementById('authPassword').value;

  if (!u || !p) {
    showAuthMsg('Συμπληρώστε όνομα χρήστη και κωδικό.');
    return;
  }

  if (p.length < 6) {
    showAuthMsg('Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.');
    return;
  }

  showAuthMsg('Δημιουργία λογαριασμού...');
  const email = formatAuthEmail(u);

  const { data, error } = await supabaseClient.auth.signUp({
    email: email,
    password: p
  });

  if (error) {
    showAuthMsg(error.message);
    return;
  }

  if (data?.user) {
    const { error: profErr } = await supabaseClient
      .from('profiles')
      .insert([
        { 
          id: data.user.id, 
          username: u, 
          initial_balance: 0.00, 
          budget_limit: 1066.00,
          cycle_start_day: 12
        }
      ]);

    if (profErr) {
      console.error(profErr);
    }
  }

  showAuthMsg('Επιτυχής εγγραφή! Συνδέεστε...', true);
  setTimeout(() => handleLogin(), 700);
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  currentUserId = null;
  document.getElementById('authPassword').value = '';
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('appWrapper').style.display = 'none';
}

/* ================= DATA MANAGEMENT ================= */
async function loadUserData() {
  if (!currentUserId) return;

  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('username, initial_balance, budget_limit, cycle_start_day')
    .eq('id', currentUserId)
    .single();

  if (profile) {
    initialBalance = parseFloat(profile.initial_balance || 0);
    budgetLimit = parseFloat(profile.budget_limit || 1066);
    cycleStartDay = parseInt(profile.cycle_start_day || 12, 10);
    tempSelectedCycleDay = cycleStartDay;
    currentUser = profile.username;
  }

  const { data: txData } = await supabaseClient
    .from('transactions')
    .select('*')
    .eq('user_id', currentUserId)
    .order('tx_datetime', { ascending: false });

  if (txData) {
    transactions = txData.map(t => ({
      id: t.id,
      type: t.type,
      amount: parseFloat(t.amount),
      title: t.title,
      category: t.category,
      reason: t.reason,
      date: t.tx_datetime,
      excludeFromCycle: Boolean(t.exclude_from_cycle)
    }));
  }

  renderApp();
}

function setupRealtimeListener() {
  supabaseClient
    .channel('public:transactions')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${currentUserId}` }, () => {
      loadUserData();
    })
    .subscribe();
}

async function initUserSession() {
  document.getElementById('currentUserName').innerText = currentUser;
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appWrapper').style.display = 'flex';
  showAuthMsg('');

  await loadUserData();
  setupRealtimeListener();
}

window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session?.user) {
    currentUserId = session.user.id;
    await loadUserData();
    initUserSession();
  }
});

/* ================= MODAL MANAGEMENT ================= */
function openModal(modalId) {
  if (modalId === 'expense' || modalId === 'income') {
    setType(modalId);
    document.getElementById('txAmount').value = '';
    document.getElementById('txTitle').value = '';
    document.getElementById('txReason').value = '';
    const exclCheck = document.getElementById('txExcludeCycle');
    if (exclCheck) exclCheck.checked = false;
    resetModalDateTime();
    document.getElementById('txModal').classList.add('active');
    return;
  }
  const el = document.getElementById(modalId);
  if (el) el.classList.add('active');
}

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('active');
}

function closeOverlay(e, modalId) {
  if (e.target.id === modalId) {
    closeModal(modalId);
  }
}

// 1. Modal Ρύθμισης Αρχικού Υπολοίπου
function openBalanceModal() {
  document.getElementById('inputStartingBalance').value = initialBalance.toFixed(2);
  openModal('balanceModal');
}

async function handleSaveStartingBalance(e) {
  e.preventDefault();
  const val = parseFloat(document.getElementById('inputStartingBalance').value);
  if (isNaN(val)) return;

  const { error } = await supabaseClient
    .from('profiles')
    .update({ initial_balance: val })
    .eq('id', currentUserId);

  if (error) {
    showToast('⚠️ Σφάλμα αποθήκευσης: ' + error.message);
    return;
  }

  initialBalance = val;
  closeModal('balanceModal');
  showToast('✅ Το αρχικό υπόλοιπο αποθηκεύτηκε!');
  renderApp();
}

// 2. Modal Ρύθμισης Ορίου
function openLimitModal() {
  document.getElementById('inputBudgetLimit').value = budgetLimit.toFixed(2);
  openModal('limitModal');
}

async function handleSaveLimit(e) {
  e.preventDefault();
  const val = parseFloat(document.getElementById('inputBudgetLimit').value);
  if (isNaN(val) || val <= 0) return;

  const { error } = await supabaseClient
    .from('profiles')
    .update({ budget_limit: val })
    .eq('id', currentUserId);

  if (error) {
    showToast('⚠️ Σφάλμα αποθήκευσης: ' + error.message);
    return;
  }

  budgetLimit = val;
  closeModal('limitModal');
  showToast('✅ Το μηνιαίο όριο ανανεώθηκε!');
  renderApp();
}

// 3. Modal Ημερολογίου / Επιλογής Έναρξης Κύκλου
function openCycleCalendarModal() {
  tempSelectedCycleDay = cycleStartDay;
  buildCalendarDaysGrid();
  openModal('cycleCalendarModal');
}

function buildCalendarDaysGrid() {
  const container = document.getElementById('calendarDaysGrid');
  if (!container) return;
  container.innerHTML = '';

  const preview = document.getElementById('calendarPreviewLabel');
  if (preview) {
    preview.innerText = `Κάθε ${tempSelectedCycleDay}η του μήνα`;
  }

  for (let d = 1; d <= 28; d++) {
    const cell = document.createElement('div');
    cell.className = `cal-day-cell ${d === tempSelectedCycleDay ? 'selected' : ''}`;
    cell.innerText = d;
    cell.onclick = () => {
      tempSelectedCycleDay = d;
      document.querySelectorAll('.cal-day-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      if (preview) {
        preview.innerText = `Κάθε ${tempSelectedCycleDay}η του μήνα`;
      }
    };
    container.appendChild(cell);
  }
}

async function confirmCycleSelection() {
  const { error } = await supabaseClient
    .from('profiles')
    .update({ cycle_start_day: tempSelectedCycleDay })
    .eq('id', currentUserId);

  if (error) {
    showToast('⚠️ Σφάλμα αποθήκευσης: ' + error.message);
    return;
  }

  cycleStartDay = tempSelectedCycleDay;
  closeModal('cycleCalendarModal');
  showToast(`✅ Ο κύκλος ξεκινάει πλέον κάθε ${cycleStartDay} του μήνα!`);
  renderApp();
}

function handleCycleTitleClick() {
  if (analysisMode === 'cycle') {
    openCycleCalendarModal();
  }
}

/* ================= ACTIONS ================= */
async function saveTx(e) {
  e.preventDefault();
  const amountVal = parseFloat(document.getElementById('txAmount').value);
  const titleVal = document.getElementById('txTitle').value.trim();
  const reasonVal = document.getElementById('txReason').value.trim();
  const catVal = document.getElementById('txCategory').value;
  const dateTimeVal = document.getElementById('txDateTime').value;
  const exclCheck = document.getElementById('txExcludeCycle');
  
  // Ισχύει μόνο για αφαίρεση (expense)
  const excludeVal = (currentType === 'expense' && exclCheck) ? exclCheck.checked : false;

  if (isNaN(amountVal) || amountVal <= 0 || !titleVal || !currentUserId) return;

  const payload = {
    user_id: currentUserId,
    type: currentType,
    amount: amountVal,
    title: titleVal,
    category: catVal,
    reason: reasonVal,
    tx_datetime: dateTimeVal ? new Date(dateTimeVal).toISOString() : new Date().toISOString(),
    exclude_from_cycle: excludeVal
  };

  const { error } = await supabaseClient.from('transactions').insert([payload]);
  if (error) {
    showToast('⚠️ Σφάλμα αποθήκευσης: ' + error.message);
    return;
  }

  closeModal('txModal');
  showToast(excludeVal ? '✅ Καταχωρήθηκε (Εκτός ορίου Κύκλου)!' : '✅ Η συναλλαγή καταχωρήθηκε!');
  await loadUserData();
}

async function deleteTx(id) {
  if (confirm('Διαγραφή αυτής της συναλλαγής;')) {
    const { error } = await supabaseClient
      .from('transactions')
      .delete()
      .eq('id', id);

    if (error) {
      showToast('⚠️ Σφάλμα διαγραφής: ' + error.message);
      return;
    }
    showToast('🗑️ Η συναλλαγή διαγράφηκε.');
    await loadUserData();
  }
}

/* ================= VIEW MODE & CHART TOGGLES ================= */
function setViewMode(mode) {
  analysisMode = mode;
  document.getElementById('viewModeCycle').className = `view-btn ${mode === 'cycle' ? 'active' : ''}`;
  document.getElementById('viewModeMonth').className = `view-btn ${mode === 'month' ? 'active' : ''}`;
  
  const cBtn = document.getElementById('cycleSettingsBtn');
  if (cBtn) {
    cBtn.style.display = mode === 'cycle' ? 'inline-flex' : 'none';
  }
  
  renderApp();
}

function setChartType(type) {
  chartType = type;
  document.getElementById('chartBtnDoughnut').className = `chart-toggle-btn ${type === 'doughnut' ? 'active' : ''}`;
  document.getElementById('chartBtnBar').className = `chart-toggle-btn ${type === 'bar' ? 'active' : ''}`;
  renderChart();
}

function exportData() {
  const exportPayload = {
    user: currentUser,
    initialBalance: initialBalance,
    budgetLimit: budgetLimit,
    cycleStartDay: cycleStartDay,
    transactions: transactions
  };
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
  const a = document.createElement('a');
  a.setAttribute("href", dataStr);
  a.setAttribute("download", `mybank_${currentUser}_backup_${new Date().toISOString().slice(0,10)}.json`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast('💾 Το αρχείο Backup κατέβηκε!');
}

/* ================= CLOCK & DATE UTILS ================= */
function updateLiveClock() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  const dateEl = document.getElementById('liveDate');
  const timeEl = document.getElementById('liveTime');
  if (dateEl) dateEl.innerText = `${dd}/${mm}/${yyyy}`;
  if (timeEl) timeEl.innerText = `${hh}:${min}:${ss}`;
}
setInterval(updateLiveClock, 1000);
updateLiveClock();

function resetModalDateTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const dtInput = document.getElementById('txDateTime');
  if (dtInput) dtInput.value = now.toISOString().slice(0, 16);
}
resetModalDateTime();

function formatCurrency(amount) {
  const parts = Math.abs(amount).toFixed(2).split('.');
  const intPart = parseInt(parts[0], 10).toLocaleString('de-DE');
  return { intPart, decPart: parts[1], isNegative: amount < 0 };
}

function getActiveCycle(now = new Date(), startDay = 12) {
  let y = now.getFullYear();
  let m = now.getMonth();
  let d = now.getDate();

  let startYear = y;
  let startMonth = m;

  if (d < startDay) {
    startMonth -= 1;
    if (startMonth < 0) {
      startMonth = 11;
      startYear -= 1;
    }
  }

  let endYear = startYear;
  let endMonth = startMonth + 1;
  if (endMonth > 11) {
    endMonth = 0;
    endYear += 1;
  }

  const cycleStart = new Date(startYear, startMonth, startDay, 0, 0, 0);
  const cycleEnd = new Date(endYear, endMonth, startDay - 1, 23, 59, 59);

  const mNames = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαϊ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
  const label = `${cycleStart.getDate()} ${mNames[cycleStart.getMonth()]} ${cycleStart.getFullYear()} - ${cycleEnd.getDate()} ${mNames[cycleEnd.getMonth()]} ${cycleEnd.getFullYear()}`;

  return { start: cycleStart, end: cycleEnd, label };
}

function getActiveMonth(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const monthStart = new Date(y, m, 1, 0, 0, 0);
  const monthEnd = new Date(y, m + 1, 0, 23, 59, 59);

  const mNames = ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"];
  const label = `${mNames[m]} ${y} (1 - ${monthEnd.getDate()} ${mNames[m].slice(0,3)})`;

  return { start: monthStart, end: monthEnd, label };
}

/* ================= RENDER LOGIC ================= */
function renderApp() {
  if (!currentUserId) return;

  // 1. Υπολογισμός συνολικού διαθέσιμου υπολοίπου (Περιλαμβάνει ΟΛΑ τα έσοδα και ΟΛΑ τα έξοδα)
  let total = initialBalance;
  transactions.forEach(t => {
    if (t.type === 'income') total += t.amount;
    else total -= t.amount;
  });

  const balEl = document.getElementById('balanceDisplay');
  if (isHidden) {
    balEl.innerHTML = '••••,•• €';
  } else {
    const { intPart, decPart, isNegative } = formatCurrency(total);
    balEl.inner
