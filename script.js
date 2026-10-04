/* ================= SUPABASE INITIALIZATION ================= */
// ΣΥΜΠΛΗΡΩΣΕ ΤΑ ΔΙΚΑ ΣΟΥ ΑΠΟ ΤΟ SUPABASE (Settings -> API)
const SUPABASE_URL = 'https://grwymznaxkqfoehysxjc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ejP6v4ml6GQg8BnZ6c1RVw_VdA9TUAX';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ================= STATE ================= */
let currentUser = null;
let currentUserId = null;
let transactions = [];
let budgetLimit = 1066.00;
let initialBalance = 0.00;
let cycleStartDay = 12; // Ημέρα έναρξης του μηνιαίου Κύκλου (π.χ. 12 = 12 έως 11 του επόμενου)
let currentType = 'expense';
let isHidden = false;
let selectedCat = 'all';

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
      date: t.tx_datetime
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

/* ================= ACTIONS ================= */
async function saveTx(e) {
  e.preventDefault();
  const amountVal = parseFloat(document.getElementById('txAmount').value);
  const titleVal = document.getElementById('txTitle').value.trim();
  const reasonVal = document.getElementById('txReason').value.trim();
  const catVal = document.getElementById('txCategory').value;
  const dateTimeVal = document.getElementById('txDateTime').value;

  if (isNaN(amountVal) || amountVal <= 0 || !titleVal || !currentUserId) return;

  const payload = {
    user_id: currentUserId,
    type: currentType,
    amount: amountVal,
    title: titleVal,
    category: catVal,
    reason: reasonVal,
    tx_datetime: dateTimeVal ? new Date(dateTimeVal).toISOString() : new Date().toISOString()
  };

  const { error } = await supabaseClient.from('transactions').insert([payload]);
  if (error) {
    alert('Σφάλμα αποθήκευσης: ' + error.message);
    return;
  }

  closeModal();
  await loadUserData();
}

async function deleteTx(id) {
  if (confirm('Διαγραφή αυτής της συναλλαγής;')) {
    const { error } = await supabaseClient
      .from('transactions')
      .delete()
      .eq('id', id);

    if (error) {
      alert('Σφάλμα διαγραφής: ' + error.message);
      return;
    }
    await loadUserData();
  }
}

async function changeLimit() {
  const val = prompt(`Ορίστε το μηνιαίο όριο εξόδων (€):`, budgetLimit);
  if (val !== null && !isNaN(parseFloat(val)) && parseFloat(val) > 0) {
    const newLimit = parseFloat(val);
    const { error } = await supabaseClient
      .from('profiles')
      .update({ budget_limit: newLimit })
      .eq('id', currentUserId);

    if (error) {
      alert('Σφάλμα: ' + error.message);
      return;
    }
    budgetLimit = newLimit;
    renderApp();
  }
}

async function changeStartingBalance() {
  const val = prompt(`Ορίστε το αρχικό ποσό υπολοίπου (€):`, initialBalance);
  if (val !== null && !isNaN(parseFloat(val))) {
    const newBal = parseFloat(val);
    const { error } = await supabaseClient
      .from('profiles')
      .update({ initial_balance: newBal })
      .eq('id', currentUserId);

    if (error) {
      alert('Σφάλμα: ' + error.message);
      return;
    }
    initialBalance = newBal;
    renderApp();
  }
}

// Ορισμός χρονικού ορίου / Κύκλου ανά χρήστη (π.χ. από 1η έως 31η κάθε μήνα)
async function changeCycleStartDay() {
  const val = prompt(`Ορίστε την ημέρα του μήνα που ξεκινάει ο Κύκλος σας (1 έως 28):`, cycleStartDay);
  if (val !== null) {
    const day = parseInt(val, 10);
    if (!isNaN(day) && day >= 1 && day <= 28) {
      const { error } = await supabaseClient
        .from('profiles')
        .update({ cycle_start_day: day })
        .eq('id', currentUserId);

      if (error) {
        alert('Σφάλμα: ' + error.message);
        return;
      }
      cycleStartDay = day;
      renderApp();
    } else {
      alert('Παρακαλώ εισάγετε μία έγκυρη ημέρα μεταξύ 1 και 28.');
    }
  }
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

// Δυναμικός υπολογισμός κύκλου με βάση την ημέρα που επέλεξε ο χρήστης
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

  return { cycleStart, cycleEnd, label };
}

/* ================= RENDER LOGIC ================= */
function renderApp() {
  if (!currentUserId) return;

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
    balEl.innerHTML = `${isNegative ? '-' : ''}${intPart},<span class="decimals">${decPart} €</span>`;
  }

  const { intPart: iInt, decPart: iDec, isNegative: iNeg } = formatCurrency(initialBalance);
  const initBalEl = document.getElementById('initialBalanceBadge');
  if (initBalEl) initBalEl.innerText = `${iNeg ? '-' : ''}${iInt},${iDec} €`;

  const now = new Date();
  const { cycleStart, cycleEnd, label } = getActiveCycle(now, cycleStartDay);
  const cycleEl = document.getElementById('budgetCycleTitle');
  if (cycleEl) cycleEl.innerText = `📅 Κύκλος: ${label}`;

  const cBadge = document.getElementById('cycleStartDayBadge');
  if (cBadge) cBadge.innerText = cycleStartDay;

  let cycleSpent = 0;
  transactions.forEach(t => {
    const tDate = new Date(t.date);
    if (t.type === 'expense' && tDate >= cycleStart && tDate <= cycleEnd) {
      cycleSpent += t.amount;
    }
  });

  const remaining = budgetLimit - cycleSpent;
  const percent = budgetLimit > 0 ? Math.min(100, Math.round((cycleSpent / budgetLimit) * 100)) : 0;

  const { intPart: sInt, decPart: sDec } = formatCurrency(cycleSpent);
  const spentEl = document.getElementById('cycleSpentVal');
  if (spentEl) spentEl.innerText = `${sInt},${sDec} €`;

  const { intPart: rInt, decPart: rDec, isNegative: rNeg } = formatCurrency(remaining);
  const remEl = document.getElementById('cycleRemainingVal');
  if (remEl) {
    remEl.innerText = `${rNeg ? '-' : ''}${rInt},${rDec} €`;
    remEl.style.color = remaining < 0 ? 'var(--accent-red)' : (remaining < 200 ? 'var(--accent-yellow)' : 'var(--text-white)');
  }

  const pEl = document.getElementById('cyclePercentVal');
  if (pEl) pEl.innerText = `${percent}%`;

  const barFill = document.getElementById('budgetProgressBar');
  if (barFill) {
    barFill.style.width = `${percent}%`;
    if (percent >= 100) barFill.style.backgroundColor = 'var(--accent-red)';
    else if (percent >= 75) barFill.style.backgroundColor = 'var(--accent-yellow)';
    else barFill.style.backgroundColor = 'var(--accent-green)';
  }

  const { intPart: lInt, decPart: lDec } = formatCurrency(budgetLimit);
  const limBadge = document.getElementById('budgetLimitBadge');
  if (limBadge) limBadge.innerText = `Όριο: ${lInt},${lDec} €`;
  const topLim = document.getElementById('topLimitBtn');
  if (topLim) topLim.innerText = `Όριο: ${lInt}€`;

  const filtered = transactions.filter(t => selectedCat === 'all' || t.category === selectedCat);
  const listEl = document.getElementById('transactionList');

  if (!listEl) return;

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Δεν υπάρχουν συναλλαγές σε αυτή την κατηγορία.<br>Πάτα <b>+ Νέα Συναλλαγή</b> για καταχώρηση!</div>';
    return;
  }

  const iconColors = {
    'Ενοίκιο': 'red',
    'Λογαριασμοί': 'orange',
    'Supermarket': 'teal',
    'Γυμναστήριο': 'purple',
    'Έξοδοι': 'blue',
    'Μετακίνηση': 'blue',
    'Μισθοδοσία': 'green',
    'Άλλο': 'orange'
  };

  listEl.innerHTML = filtered.map(t => {
    const isIncome = t.type === 'income';
    const color = iconColors[t.category] || (isIncome ? 'green' : 'blue');
    const sign = isIncome ? '+' : '-';
    const amountClass = isIncome ? 'income' : 'expense';
    const { intPart, decPart } = formatCurrency(t.amount);
    const iconChar = t.category === 'Ενοίκιο' ? '🏠' : (t.category === 'Γυμναστήριο' ? '🥊' : (t.category === 'Supermarket' ? '🛒' : (t.category === 'Λογαριασμοί' ? '💡' : (t.category === 'Έξοδοι' ? '☕' : (t.title[0] || '€')))));

    const d = new Date(t.date);
    const dateFormatted = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth()+1).padStart(2, '0')}/${d.getFullYear()}`;
    const timeFormatted = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    return `
      <div class="tx-item">
        <div class="tx-left">
          <div class="tx-icon-badge tx-icon-${color}">${iconChar}</div>
          <div class="tx-details">
            <div class="tx-name">${t.title}</div>
            <div class="tx-meta">${dateFormatted} • ${timeFormatted} • ${t.reason || t.category || ''}</div>
          </div>
        </div>
        <div class="tx-right">
          <div class="tx-amt ${amountClass}">${sign} ${intPart},${decPart} €</div>
          <button class="del-btn" onclick="deleteTx(${t.id})" title="Διαγραφή">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function filterCategory(cat, el) {
  selectedCat = cat;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderApp();
}

function openModal(type = 'expense') {
  currentType = type;
  setType(type);
  document.getElementById('txAmount').value = '';
  document.getElementById('txTitle').value = '';
  document.getElementById('txReason').value = '';
  resetModalDateTime();
  document.getElementById('txModal').classList.add('active');
}

function closeModal() {
  document.getElementById('txModal').classList.remove('active');
}

function closeOverlay(e) {
  if (e.target === document.getElementById('txModal')) closeModal();
}

function setType(type) {
  currentType = type;
  const bExp = document.getElementById('btnExpense');
  const bInc = document.getElementById('btnIncome');
  if (type === 'expense') {
    bExp.className = 'seg-btn active expense';
    bInc.className = 'seg-btn';
  } else {
    bInc.className = 'seg-btn active income';
    bExp.className = 'seg-btn';
  }
}

const toggleEye = document.getElementById('toggleEyeBtn');
if (toggleEye) {
  toggleEye.addEventListener('click', () => {
    isHidden = !isHidden;
    renderApp();
  });
}

const scrollBox = document.getElementById('catScroll');
if (scrollBox) {
  scrollBox.addEventListener('wheel', (evt) => {
    if (evt.deltaY !== 0) {
      evt.preventDefault();
      scrollBox.scrollLeft += evt.deltaY;
    }
  }, { passive: false });
}
