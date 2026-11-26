/* ================= SUPABASE INITIALIZATION ================= */
const SUPABASE_URL = 'https://grwymznaxkqfoehysxjc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ejP6v4ml6GQg8BnZ6c1RVw_VdA9TUAX';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ================= STATE ================= */
let currentUser = null;
let currentUserId = null;

let initialSavings = 0.00;
let monthlyTarget = 200.00;
let emergencyTarget = 1500.00;
let withdrawalLocked = false;

let savingsGoals = [];
let savingsTransactions = [];

let currentTxType = 'deposit';
let selectedCategory = 'all';
let isHidden = false;
let chartMode = 'growth'; // 'growth' | 'pots'
let savingsChartInstance = null;

/* ================= TOAST ================= */
let toastTimer;
function showToast(msg, duration = 3000) {
  const el = document.getElementById('toastNotification');
  const txt = document.getElementById('toastMsg');
  if (!el || !txt) return;
  txt.innerText = msg;
  el.classList.add('active');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('active'), duration);
}

/* ================= AUTHENTICATION ================= */
function formatAuthEmail(username) {
  return `${username.toLowerCase().trim()}@mybank.local`;
}

async function handleLogin() {
  const u = document.getElementById('authUsername').value.trim().toLowerCase();
  const p = document.getElementById('authPassword').value;
  const msg = document.getElementById('authMessage');

  if (!u || !p) {
    msg.innerText = 'Συμπληρώστε όνομα χρήστη και κωδικό.';
    return;
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: formatAuthEmail(u),
    password: p
  });

  if (error) {
    msg.innerText = 'Λανθασμένο όνομα χρήστη ή κωδικός.';
    return;
  }

  currentUser = u;
  currentUserId = data.user.id;
  await initSavingsSession();
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
}

window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session?.user) {
    currentUserId = session.user.id;
    currentUser = session.user.email.split('@')[0];
    await initSavingsSession();
  } else {
    document.getElementById('authScreen').style.display = 'flex';
  }
});

async function initSavingsSession() {
  document.getElementById('currentUserName').innerText = currentUser;
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appWrapper').style.display = 'flex';

  await ensureSavingsProfile();
  await loadSavingsData();
  setupRealtime();
}

async function ensureSavingsProfile() {
  const { data } = await supabaseClient
    .from('savings_profiles')
    .select('*')
    .eq('id', currentUserId)
    .maybeSingle();

  if (!data) {
    await supabaseClient.from('savings_profiles').insert([{
      id: currentUserId,
      initial_savings: 0.00,
      monthly_target: 200.00,
      emergency_target: 1500.00,
      withdrawal_locked: false
    }]);
  }
}

/* ================= LOAD DATA ================= */
async function loadSavingsData() {
  if (!currentUserId) return;

  const { data: prof } = await supabaseClient
    .from('savings_profiles')
    .select('*')
    .eq('id', currentUserId)
    .single();

  if (prof) {
    initialSavings = parseFloat(prof.initial_savings || 0);
    monthlyTarget = parseFloat(prof.monthly_target || 200);
    emergencyTarget = parseFloat(prof.emergency_target || 1500);
    withdrawalLocked = Boolean(prof.withdrawal_locked);
  }

  const { data: goalsData } = await supabaseClient
    .from('savings_goals')
    .select('*')
    .eq('user_id', currentUserId)
    .order('created_at', { ascending: true });

  savingsGoals = (goalsData || []).map(g => ({
    id: g.id,
    title: g.title,
    category: g.category,
    targetAmount: parseFloat(g.target_amount),
    currentAmount: parseFloat(g.current_amount),
    deadline: g.deadline
  }));

  const { data: txData } = await supabaseClient
    .from('savings_transactions')
    .select('*')
    .eq('user_id', currentUserId)
    .order('tx_datetime', { ascending: false });

  savingsTransactions = (txData || []).map(t => ({
    id: t.id,
    goalId: t.goal_id,
    type: t.type,
    amount: parseFloat(t.amount),
    title: t.title,
    category: t.category,
    reason: t.reason,
    date: t.tx_datetime
  }));

  renderSavingsApp();
}

function setupRealtime() {
  supabaseClient
    .channel('public:savings_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'savings_transactions', filter: `user_id=eq.${currentUserId}` }, () => loadSavingsData())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'savings_goals', filter: `user_id=eq.${currentUserId}` }, () => loadSavingsData())
    .subscribe();
}

/* ================= MODALS & ACTIONS ================= */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

function closeOverlay(e, id) {
  if (e.target.id === id) closeModal(id);
}

function populateGoalSelects() {
  const opts = ['<option value="">🐷 Γενικό Ταμείο (Χωρίς συγκεκριμένο στόχο)</option>'];
  savingsGoals.forEach(g => {
    opts.push(`<option value="${g.id}">🎯 ${g.title} (${g.currentAmount.toFixed(0)}€ / ${g.targetAmount.toFixed(0)}€)</option>`);
  });

  const s1 = document.getElementById('stxGoalSelect');
  const s2 = document.getElementById('rolloverGoalSelect');
  if (s1) s1.innerHTML = opts.join('');
  if (s2) s2.innerHTML = opts.join('');
}

function attemptWithdrawModal() {
  if (withdrawalLocked) {
    openModal('lockWarningModal');
  } else {
    openSavingsTxModal('withdraw');
  }
}

function proceedUnlockedWithdraw() {
  closeModal('lockWarningModal');
  openSavingsTxModal('withdraw');
}

async function toggleWithdrawalLock() {
  const nextState = !withdrawalLocked;
  const { error } = await supabaseClient
    .from('savings_profiles')
    .update({ withdrawal_locked: nextState })
    .eq('id', currentUserId);

  if (error) {
    showToast('⚠️ Σφάλμα ενημέρωσης κλειδώματος.');
    return;
  }

  withdrawalLocked = nextState;
  showToast(withdrawalLocked ? '🔒 Οι αναλήψεις κλειδώθηκαν!' : '🔓 Οι αναλήψεις ξεκλειδώθηκαν.');
  renderSavingsApp();
}

function openSavingsTxModal(type = 'deposit', preselectedGoalId = '') {
  populateGoalSelects();
  setSavingsTxType(type);
  document.getElementById('stxAmount').value = '';
  document.getElementById('stxTitle').value = '';
  document.getElementById('stxReason').value = '';
  if (preselectedGoalId) {
    document.getElementById('stxGoalSelect').value = String(preselectedGoalId);
  }

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('stxDateTime').value = now.toISOString().slice(0, 16);

  openModal('savingsTxModal');
}

function setSavingsTxType(type) {
  currentTxType = type;
  const bDep = document.getElementById('btnDeposit');
  const bWit = document.getElementById('btnWithdraw');
  if (type === 'deposit') {
    bDep.className = 'seg-btn active income';
    bWit.className = 'seg-btn';
  } else {
    bWit.className = 'seg-btn active expense';
    bDep.className = 'seg-btn';
  }
}

async function saveSavingsTx(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('stxAmount').value);
  const goalIdRaw = document.getElementById('stxGoalSelect').value;
  const goalId = goalIdRaw ? parseInt(goalIdRaw, 10) : null;
  const category = document.getElementById('stxCategory').value;
  const title = document.getElementById('stxTitle').value.trim();
  const reason = document.getElementById('stxReason').value.trim();
  const dtVal = document.getElementById('stxDateTime').value;

  if (isNaN(amount) || amount <= 0 || !title) return;

  const { error } = await supabaseClient.from('savings_transactions').insert([{
    user_id: currentUserId,
    goal_id: goalId,
    type: currentTxType,
    amount: amount,
    title: title,
    category: category,
    reason: reason,
    tx_datetime: dtVal ? new Date(dtVal).toISOString() : new Date().toISOString()
  }]);

  if (error) {
    showToast('⚠️ Σφάλμα: ' + error.message);
    return;
  }

  if (goalId) {
    const goal = savingsGoals.find(g => g.id === goalId);
    if (goal) {
      const updatedAmt = currentTxType === 'deposit'
        ? goal.currentAmount + amount
        : Math.max(0, goal.currentAmount - amount);

      await supabaseClient
        .from('savings_goals')
        .update({ current_amount: updatedAmt })
        .eq('id', goalId);
    }
  }

  closeModal('savingsTxModal');
  showToast(currentTxType === 'deposit' ? '✅ Η κατάθεση προστέθηκε!' : '✅ Η ανάληψη καταχωρήθηκε!');
  await loadSavingsData();
}

async function deleteSavingsTx(id) {
  if (!confirm('Διαγραφή αυτής της κίνησης αποταμίευσης;')) return;

  const tx = savingsTransactions.find(t => t.id === id);
  const { error } = await supabaseClient.from('savings_transactions').delete().eq('id', id);

  if (error) {
    showToast('⚠️ Σφάλμα διαγραφής: ' + error.message);
    return;
  }

  if (tx && tx.goalId) {
    const goal = savingsGoals.find(g => g.id === tx.goalId);
    if (goal) {
      const reverted = tx.type === 'deposit'
        ? Math.max(0, goal.currentAmount - tx.amount)
        : goal.currentAmount + tx.amount;

      await supabaseClient
        .from('savings_goals')
        .update({ current_amount: reverted })
        .eq('id', tx.goalId);
    }
  }

  showToast('🗑️ Η κίνηση διαγράφηκε.');
  await loadSavingsData();
}

/* ================= GOALS / POTS ================= */
function openGoalModal() {
  document.getElementById('goalTitle').value = '';
  document.getElementById('goalTargetAmount').value = '';
  document.getElementById('goalCurrentAmount').value = '0';
  document.getElementById('goalDeadline').value = '';
  openModal('goalModal');
}

async function saveGoal(e) {
  e.preventDefault();
  const title = document.getElementById('goalTitle').value.trim();
  const category = document.getElementById('goalCategory').value;
  const targetAmount = parseFloat(document.getElementById('goalTargetAmount').value);
  const currentAmount = parseFloat(document.getElementById('goalCurrentAmount').value || 0);
  const deadline = document.getElementById('goalDeadline').value || null;

  if (!title || isNaN(targetAmount) || targetAmount <= 0) return;

  const { error } = await supabaseClient.from('savings_goals').insert([{
    user_id: currentUserId,
    title: title,
    category: category,
    target_amount: targetAmount,
    current_amount: currentAmount,
    deadline: deadline
  }]);

  if (error) {
    showToast('⚠️ Σφάλμα δημιουργίας στόχου: ' + error.message);
    return;
  }

  closeModal('goalModal');
  showToast('🎯 Ο νέος κουμπαράς δημιουργήθηκε!');
  await loadSavingsData();
}

async function deleteGoal(id) {
  if (!confirm('Διαγραφή αυτού του κουμπαρά; (Τα χρήματα παραμένουν στο συνολικό ταμείο)')) return;
  const { error } = await supabaseClient.from('savings_goals').delete().eq('id', id);
  if (error) {
    showToast('⚠️ Σφάλμα: ' + error.message);
    return;
  }
  showToast('🗑️ Ο κουμπαράς διαγράφηκε.');
  await loadSavingsData();
}

/* ================= TARGETS & INITIAL SAVINGS ================= */
function openInitialSavingsModal() {
  document.getElementById('inputInitialSavings').value = initialSavings.toFixed(2);
  openModal('initialSavingsModal');
}

async function saveInitialSavings(e) {
  e.preventDefault();
  const val = parseFloat(document.getElementById('inputInitialSavings').value);
  if (isNaN(val)) return;

  const { error } = await supabaseClient
    .from('savings_profiles')
    .update({ initial_savings: val })
    .eq('id', currentUserId);

  if (error) {
    showToast('⚠️ Σφάλμα: ' + error.message);
    return;
  }

  initialSavings = val;
  closeModal('initialSavingsModal');
  showToast('✅ Το αρχικό κεφάλαιο αποθηκεύτηκε!');
  renderSavingsApp();
}

function openTargetsModal() {
  document.getElementById('inputMonthlyTarget').value = monthlyTarget.toFixed(2);
  document.getElementById('inputEmergencyTarget').value = emergencyTarget.toFixed(2);
  openModal('targetsModal');
}

async function saveTargets(e) {
  e.preventDefault();
  const mVal = parseFloat(document.getElementById('inputMonthlyTarget').value);
  const eVal = parseFloat(document.getElementById('inputEmergencyTarget').value);
  if (isNaN(mVal) || mVal <= 0 || isNaN(eVal) || eVal <= 0) return;

  const { error } = await supabaseClient
    .from('savings_profiles')
    .update({ monthly_target: mVal, emergency_target: eVal })
    .eq('id', currentUserId);

  if (error) {
    showToast('⚠️ Σφάλμα: ' + error.message);
    return;
  }

  monthlyTarget = mVal;
  emergencyTarget = eVal;
  closeModal('targetsModal');
  showToast('✅ Οι στόχοι ενημερώθηκαν!');
  renderSavingsApp();
}

/* ================= CYCLE ROLLOVER ================= */
async function openRolloverModal() {
  populateGoalSelects();
  document.getElementById('rolloverAmount').value = '';
  document.getElementById('mainAccountAvailableBadge').innerText = 'Υπολογισμός...';
  openModal('rolloverModal');

  const { data: prof } = await supabaseClient
    .from('profiles')
    .select('initial_balance')
    .eq('id', currentUserId)
    .single();

  const { data: mainTxs } = await supabaseClient
    .from('transactions')
    .select('type, amount')
    .eq('user_id', currentUserId);

  let mainBal = parseFloat(prof?.initial_balance || 0);
  (mainTxs || []).forEach(t => {
    if (t.type === 'income') mainBal += parseFloat(t.amount);
    else mainBal -= parseFloat(t.amount);
  });

  const { intPart, decPart, isNegative } = formatCurrency(mainBal);
  document.getElementById('mainAccountAvailableBadge').innerText = `${isNegative ? '-' : ''}${intPart},${decPart} €`;
}

async function executeCycleRollover(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('rolloverAmount').value);
  const goalIdRaw = document.getElementById('rolloverGoalSelect').value;
  const goalId = goalIdRaw ? parseInt(goalIdRaw, 10) : null;
  const deductMain = document.getElementById('rolloverDeductMain').checked;

  if (isNaN(amount) || amount <= 0) return;

  const nowIso = new Date().toISOString();

  const { error: savErr } = await supabaseClient.from('savings_transactions').insert([{
    user_id: currentUserId,
    goal_id: goalId,
    type: 'deposit',
    amount: amount,
    title: 'Μεταφορά Υπολοίπου Κύκλου',
    category: 'Μεταφορά Κύκλου',
    reason: 'Αυτόματη μεταφορά περισσεύματος',
    tx_datetime: nowIso
  }]);

  if (savErr) {
    showToast('⚠️ Σφάλμα μεταφοράς: ' + savErr.message);
    return;
  }

  if (goalId) {
    const goal = savingsGoals.find(g => g.id === goalId);
    if (goal) {
      await supabaseClient
        .from('savings_goals')
        .update({ current_amount: goal.currentAmount + amount })
        .eq('id', goalId);
    }
  }

  if (deductMain) {
    await supabaseClient.from('transactions').insert([{
      user_id: currentUserId,
      type: 'expense',
      amount: amount,
      title: 'Μεταφορά στην Αποταμίευση',
      category: 'Άλλο',
      reason: 'Αποταμίευση Κύκλου',
      tx_datetime: nowIso,
      exclude_from_cycle: true
    }]);
  }

  closeModal('rolloverModal');
  showToast(`🔄 Μεταφέρθηκαν ${amount.toFixed(2)} € στην Αποταμίευση!`);
  await loadSavingsData();
}

/* ================= FORMAT & ETA HELPERS ================= */
function formatCurrency(amount) {
  const parts = Math.abs(amount).toFixed(2).split('.');
  const intPart = parseInt(parts[0], 10).toLocaleString('de-DE');
  return { intPart, decPart: parts[1], isNegative: amount < 0 };
}

function calculateGoalETA(remainingAmount) {
  if (remainingAmount <= 0) return '🎉 Ο στόχος επιτεύχθηκε!';
  if (monthlyTarget <= 0) return 'Ορίστε μηνιαίο στόχο';

  const monthsNeeded = Math.ceil(remainingAmount / monthlyTarget);
  const etaDate = new Date();
  etaDate.setMonth(etaDate.getMonth() + monthsNeeded);

  const mNames = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαϊ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
  return `Εκτίμηση: ${mNames[etaDate.getMonth()]} ${etaDate.getFullYear()} (~${monthsNeeded} μήνες)`;
}

/* ================= RENDER UI ================= */
function renderSavingsApp() {
  if (!currentUserId) return;

  let totalSavings = initialSavings;
  savingsTransactions.forEach(t => {
    if (t.type === 'deposit') totalSavings += t.amount;
    else totalSavings -= t.amount;
  });

  const balEl = document.getElementById('savingsBalanceDisplay');
  if (isHidden) {
    balEl.innerHTML = '••••,•• €';
  } else {
    const { intPart, decPart, isNegative } = formatCurrency(totalSavings);
    balEl.innerHTML = `${isNegative ? '-' : ''}${intPart},<span class="decimals">${decPart} €</span>`;
  }

  const { intPart: iInt, decPart: iDec } = formatCurrency(initialSavings);
  document.getElementById('initialSavingsBadge').innerText = `${iInt},${iDec} €`;

  const allocated = savingsGoals.reduce((sum, g) => sum + g.currentAmount, 0);
  const unallocated = Math.max(0, totalSavings - allocated);

  const { intPart: aInt, decPart: aDec } = formatCurrency(allocated);
  const { intPart: uInt, decPart: uDec } = formatCurrency(unallocated);
  document.getElementById('allocatedGoalsVal').innerText = `${aInt},${aDec} €`;
  document.getElementById('unallocatedVal').innerText = `${uInt},${uDec} €`;

  const lockBtn = document.getElementById('lockToggleBtn');
  if (withdrawalLocked) {
    lockBtn.classList.add('locked');
    document.getElementById('lockIcon').innerText = '🔒';
    document.getElementById('lockLabel').innerText = 'Κλειδωμένο';
  } else {
    lockBtn.classList.remove('locked');
    document.getElementById('lockIcon').innerText = '🔓';
    document.getElementById('lockLabel').innerText = 'Ανοιχτό';
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  let monthlyDeposited = 0;
  savingsTransactions.forEach(t => {
    const d = new Date(t.date);
    if (t.type === 'deposit' && d >= startOfMonth) {
      monthlyDeposited += t.amount;
    }
  });

  const mPercent = monthlyTarget > 0 ? Math.min(100, Math.round((monthlyDeposited / monthlyTarget) * 100)) : 0;
  const { intPart: mtInt, decPart: mtDec } = formatCurrency(monthlyTarget);
  const { intPart: mdInt, decPart: mdDec } = formatCurrency(monthlyDeposited);

  document.getElementById('monthlyTargetBadge').innerText = `Στόχος: ${mtInt},${mtDec} €`;
  document.getElementById('monthlyDepositedVal').innerText = `${mdInt},${mdDec} €`;
  document.getElementById('monthlyPercentVal').innerText = `${mPercent}%`;
  document.getElementById('monthlyProgressBar').style.width = `${mPercent}%`;

  const ePercent = emergencyTarget > 0 ? Math.min(100, Math.round((Math.max(0, totalSavings) / emergencyTarget) * 100)) : 0;
  const { intPart: etInt, decPart: etDec } = formatCurrency(emergencyTarget);
  const { intPart: ecInt, decPart: ecDec } = formatCurrency(Math.max(0, totalSavings));

  document.getElementById('emergencyTargetBadge').innerText = `Στόχος: ${etInt},${etDec} €`;
  document.getElementById('emergencyCurrentVal').innerText = `${ecInt},${ecDec} €`;
  document.getElementById('emergencyPercentVal').innerText = `${ePercent}%`;
  document.getElementById('emergencyProgressBar').style.width = `${ePercent}%`;

  renderGoalsGrid();
  renderTransactionsList();
  renderSavingsChart();
}

function renderGoalsGrid() {
  const grid = document.getElementById('goalsGrid');
  if (!grid) return;

  if (savingsGoals.length === 0) {
    grid.innerHTML = `<div class="empty-goals-box">Δεν έχετε δημιουργήσει ακόμα κάποιον Κουμπαρά.<br>Πάτα <b>+ Δημιουργία Κουμπαρά</b> για να βάλεις τον πρώτο σου στόχο!</div>`;
    return;
  }

  grid.innerHTML = savingsGoals.map(g => {
    const pct = g.targetAmount > 0 ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100)) : 0;
    const rem = Math.max(0, g.targetAmount - g.currentAmount);
    const etaText = calculateGoalETA(rem);
    const { intPart: cInt, decPart: cDec } = formatCurrency(g.currentAmount);
    const { intPart: tInt } = formatCurrency(g.targetAmount);

    return `
      <div class="goal-card">
        <div class="goal-card-top">
          <div>
            <div class="goal-name">${g.title}</div>
            <div class="goal-cat-badge">${g.category} ${g.deadline ? '• Λήξη: ' + g.deadline : ''}</div>
          </div>
          <button class="goal-del-btn" onclick="deleteGoal(${g.id})" title="Διαγραφή στόχου">✕</button>
        </div>

        <div class="goal-amounts">
          <span><b>${cInt},${cDec} €</b> / ${tInt} €</span>
          <span style="font-weight:700; color: var(--accent-yellow);">${pct}%</span>
        </div>

        <div class="progress-bar-bg">
          <div class="progress-bar-fill ${pct >= 100 ? 'green' : 'yellow'}" style="width: ${pct}%;"></div>
        </div>

        <div class="goal-footer">
          <span>${etaText}</span>
          <button class="goal-quick-add" onclick="openSavingsTxModal('deposit', ${g.id})">+ Βάλε</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderTransactionsList() {
  const listEl = document.getElementById('savingsTxList');
  if (!listEl) return;

  const filtered = savingsTransactions.filter(t => selectedCategory === 'all' || t.category === selectedCategory);

  if (filtered.length === 0) {
    listEl.innerHTML = `<div style="text-align:center; padding:40px 10px; color:var(--text-muted); font-size:13px;">Δεν υπάρχουν καταχωρημένες κινήσεις αποταμίευσης.</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(t => {
    const isDeposit = t.type === 'deposit';
    const sign = isDeposit ? '+' : '-';
    const { intPart, decPart } = formatCurrency(t.amount);
    const d = new Date(t.date);
    const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const linkedGoal = t.goalId ? savingsGoals.find(g => g.id === t.goalId) : null;
    const goalTag = linkedGoal ? `<span class="goal-link-pill">🎯 ${linkedGoal.title}</span>` : '';

    return `
      <div class="tx-item">
        <div class="tx-left">
          <div class="tx-icon-badge ${isDeposit ? '' : 'withdraw'}">${isDeposit ? '🐷' : '💸'}</div>
          <div>
            <div class="tx-name">${t.title} ${goalTag}</div>
            <div class="tx-meta">${dateStr} • ${t.category}${t.reason ? ' • ' + t.reason : ''}</div>
          </div>
        </div>
        <div class="tx-right">
          <div class="tx-amt ${isDeposit ? 'deposit' : 'withdraw'}">${sign} ${intPart},${decPart} €</div>
          <button class="del-btn" onclick="deleteSavingsTx(${t.id})" title="Διαγραφή">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function filterSavingsCategory(cat, el) {
  selectedCategory = cat;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderTransactionsList();
}

function setSavingsChartMode(mode) {
  chartMode = mode;
  document.getElementById('chartBtnGrowth').className = `chart-toggle-btn ${mode === 'growth' ? 'active' : ''}`;
  document.getElementById('chartBtnPots').className = `chart-toggle-btn ${mode === 'pots' ? 'active' : ''}`;
  document.getElementById('chartSubtitle').innerText = mode === 'growth' ? 'Αύξηση κεφαλαίου ανά μήνα' : 'Κατανομή ανά Κουμπαρά';
  renderSavingsChart();
}

function renderSavingsChart() {
  const canvas = document.getElementById('savingsChart');
  const emptyMsg = document.getElementById('chartEmptyMsg');
  if (!canvas) return;

  if (savingsChartInstance) {
    savingsChartInstance.destroy();
    savingsChartInstance = null;
  }

  const ctx = canvas.getContext('2d');

  if (chartMode === 'pots') {
    if (savingsGoals.length === 0) {
      canvas.style.display = 'none';
      emptyMsg.style.display = 'block';
      return;
    }

    canvas.style.display = 'block';
    emptyMsg.style.display = 'none';

    const labels = savingsGoals.map(g => g.title);
    const values = savingsGoals.map(g => g.currentAmount);
    const palette = ['#2ecc71', '#fdbb11', '#3498db', '#9b59b6', '#e67e22', '#1abc9c'];

    savingsChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: labels.map((_, i) => palette[i % palette.length]),
          borderColor: '#15181e',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: '#fff', font: { size: 11 } } }
        },
        cutout: '62%'
      }
    });
  } else {
    const months = [];
    const now = new Date();
    const mNames = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαϊ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endOfM = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      let cumulative = initialSavings;
      savingsTransactions.forEach(t => {
        if (new Date(t.date) <= endOfM) {
          cumulative += (t.type === 'deposit' ? t.amount : -t.amount);
        }
      });
      months.push({ label: `${mNames[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`, value: Math.max(0, cumulative) });
    }

    canvas.style.display = 'block';
    emptyMsg.style.display = 'none';

    savingsChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: months.map(m => m.label),
        datasets: [{
          label: 'Συνολικό Κεφάλαιο (€)',
          data: months.map(m => m.value),
          borderColor: '#2ecc71',
          backgroundColor: 'rgba(46, 204, 113, 0.16)',
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#2ecc71',
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#8c93a3', font: { size: 11 } }, grid: { display: false } },
          y: { ticks: { color: '#8c93a3', font: { size: 11 }, callback: v => v + '€' }, grid: { color: '#272c38' } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }
}

function exportSavingsData() {
  const payload = {
    user: currentUser,
    initialSavings,
    monthlyTarget,
    emergencyTarget,
    goals: savingsGoals,
    transactions: savingsTransactions
  };
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
  const a = document.createElement('a');
  a.setAttribute("href", dataStr);
  a.setAttribute("download", `mybank_savings_${currentUser}_${new Date().toISOString().slice(0,10)}.json`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast('💾 Το Backup αποταμίευσης κατέβηκε!');
}

const eyeBtn = document.getElementById('toggleEyeBtn');
if (eyeBtn) {
  eyeBtn.addEventListener('click', () => {
    isHidden = !isHidden;
    renderSavingsApp();
  });
}