/* ═══════════════════════════════════════════
   RENOTRACE PRO — app.js v2.0
   ═══════════════════════════════════════════ */

'use strict';

// ═══ CONFIG ═══
const APP_VER = '2.0';
const DB_KEY  = 'rtp_db_v2';
const SES_KEY = 'rtp_session';
const ROLES = {
  superadmin: { label: 'Super Admin', icon: '🛡️', color: '#7C3AED', level: 5 },
  dirigeant:  { label: 'Dirigeant',   icon: '👔', color: '#2563EB', level: 4 },
  conducteur: { label: 'Conducteur',  icon: '🚗', color: '#0891B2', level: 3 },
  chef:       { label: 'Chef chantier', icon: '👷', color: '#D97706', level: 2 },
  technicien: { label: 'Technicien',  icon: '🔧', color: '#16A34A', level: 1 },
};
const SURFACES = ['Sol', 'Mur', 'Plafond', 'Façade', 'Combles', 'Autre'];
const AVATAR_COLORS = ['#2563EB','#7C3AED','#D97706','#16A34A','#DC2626','#0891B2','#9333EA'];

// ═══ GROQ KEY POOL — chargées depuis Google Apps Script (clés absentes du source) ═══
const GROQ_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzVFuPw5tzYHYbyW3a4A7-KFHxhehKDXrrC0H1KZVNKuDl6CDAeAs0YyW2O4AOkVJ54/exec'; // ← coller l'URL après déploiement
let GROQ_POOL = [];
let groqPoolIdx = 0;

async function loadGroqKeys() {
  if (!GROQ_SCRIPT_URL || GROQ_SCRIPT_URL.startsWith('REMPLACER')) return;
  try {
    const r = await fetch(GROQ_SCRIPT_URL, { cache: 'no-store' });
    const d = await r.json();
    if (Array.isArray(d.keys) && d.keys.length) {
      GROQ_POOL = d.keys;
      groqPoolIdx = Math.floor(Math.random() * GROQ_POOL.length);
    }
  } catch {}
}

// ═══ STATE ═══
let db, session, camStream, camFacing = 'environment', currentGps = null, currentChantier = null, aiHistory = [];
let deferredInstall = null, driveToken = null, syncTimer = null;
let fbDb = null, fbListening = false;

// ═══════════════════════════════════════════
//   CRYPTOGRAPHIE — Web Crypto API
//   Mots de passe : PBKDF2-SHA256 (100 000 itérations, sel aléatoire par utilisateur)
//   Base de données : AES-GCM 256 bits
// ═══════════════════════════════════════════

// Dérive une clé AES-GCM depuis une passphrase fixe + sel applicatif
async function _getStorageKey() {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey(
    'raw', enc.encode('RénoTrace_Pro_AES_StorageKey_2026'),
    'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('rtp_aes_salt_v2'), iterations: 60000, hash: 'SHA-256' },
    keyMat, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

// Chiffre un objet JS → chaîne base64 stockable
async function _encrypt(obj) {
  const key = await _getStorageKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const ct  = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(JSON.stringify(obj))
  );
  return JSON.stringify({
    v: 3,
    iv: btoa(String.fromCharCode(...iv)),
    ct: btoa(String.fromCharCode(...new Uint8Array(ct)))
  });
}

// Déchiffre une chaîne stockée → objet JS (null si échec)
async function _decrypt(str) {
  try {
    const { v, iv: ivB64, ct: ctB64 } = JSON.parse(str);
    if (v !== 3) return null;
    const key = await _getStorageKey();
    const iv  = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
    const ct  = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
    const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(pt));
  } catch { return null; }
}

// Hash PBKDF2-SHA256 avec sel aléatoire par utilisateur → {hash, salt}
async function hashPwdSafe(pwd, saltB64 = null) {
  const enc     = new TextEncoder();
  const saltArr = saltB64
    ? Uint8Array.from(atob(saltB64), c => c.charCodeAt(0))
    : crypto.getRandomValues(new Uint8Array(16));
  const keyMat  = await crypto.subtle.importKey('raw', enc.encode(pwd), 'PBKDF2', false, ['deriveBits']);
  const bits    = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltArr, iterations: 100000, hash: 'SHA-256' },
    keyMat, 256
  );
  return {
    hash: Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join(''),
    salt: btoa(String.fromCharCode(...saltArr))
  };
}

// Vérifie un mot de passe contre le hash/sel stockés
async function verifyPwd(pwd, storedHash, storedSalt) {
  if (!storedHash || !storedSalt) return false;
  const { hash } = await hashPwdSafe(pwd, storedSalt);
  return hash === storedHash;
}

// ═══════════════════════════════════════════
//   JOURNAL D'AUDIT
// ═══════════════════════════════════════════
function addAuditLog(action, detail = '') {
  if (!db.auditLog) db.auditLog = [];
  db.auditLog.unshift({
    id: uid(), userId: session?.userId,
    userName: me()?.name || 'Système',
    action, detail, timestamp: now()
  });
  if (db.auditLog.length > 500) db.auditLog = db.auditLog.slice(0, 500);
}

// ═══════════════════════════════════════════
//   SESSION SÉCURISÉE
// ═══════════════════════════════════════════
let sessionTimer;
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
function startSessionTimer() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    session = null;
    sessionStorage.removeItem(SES_KEY);
    navigate('login');
    toast('Session expirée — reconnectez-vous', 'warning');
  }, SESSION_TIMEOUT);
}
function resetSessionTimer() { if (session) startSessionTimer(); }

// Force de mot de passe — retourne 0 (faible) à 4 (fort)
function pwdStrength(pwd) {
  let s = 0;
  if (pwd.length >= 8)  s++;
  if (pwd.length >= 12) s++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) s++;
  if (/[0-9]/.test(pwd)) s++;
  if (/[^A-Za-z0-9]/.test(pwd)) s++;
  return Math.min(s, 4);
}
function pwdStrengthHtml(inputId) {
  return `<div id="pwdBar" style="height:4px;border-radius:2px;margin-top:4px;background:var(--border);transition:all .3s">
    <div id="pwdFill" style="height:100%;border-radius:2px;width:0%;transition:all .3s"></div>
  </div>
  <div id="pwdLabel" style="font-size:11px;color:var(--text3);margin-top:3px"></div>`;
}
function updatePwdStrength(pwd) {
  const fill  = document.getElementById('pwdFill');
  const label = document.getElementById('pwdLabel');
  if (!fill || !label) return;
  const s = pwdStrength(pwd);
  const colors = ['#DC2626','#EA580C','#D97706','#16A34A','#0891B2'];
  const labels = ['Très faible','Faible','Moyen','Fort','Très fort'];
  fill.style.width  = ((s + 1) / 5 * 100) + '%';
  fill.style.background = colors[s];
  label.textContent = labels[s];
  label.style.color = colors[s];
}

// ═══════════════════════════════════════════
//   DATABASE (chiffrée AES-GCM)
// ═══════════════════════════════════════════
async function dbLoad() {
  const stored = localStorage.getItem(DB_KEY);
  db = null;
  if (stored) {
    // Essai déchiffrement AES-GCM (v3)
    if (stored.startsWith('{"v":3')) db = await _decrypt(stored);
    // Migration données non chiffrées (anciennes versions)
    if (!db) { try { db = JSON.parse(stored); } catch {} }
  }
  db = db || {};
  if (!db.users)          db.users = [];
  if (!db.chantiers)      db.chantiers = [];
  if (!db.photos)         db.photos = [];
  if (!db.issues)         db.issues = [];
  if (!db.pendingRequests) db.pendingRequests = [];
  if (!db.auditLog)       db.auditLog = [];
  if (!db.tasks)          db.tasks = [];
  if (!db.settings)       db.settings = { companyName: 'Mon Entreprise', notifTime: '16:30' };
  // Seeding : un seul compte admin, mot de passe en PBKDF2
  if (!db.users.length) {
    const { hash, salt } = await hashPwdSafe('1234');
    db.users.push({
      id: 'sa_001', username: 'admin', name: 'Administrateur',
      role: 'superadmin', passwordHash: hash, passwordSalt: salt,
      email: null, mustChangePwd: false,
      createdAt: now(), lastLogin: null, avatarColor: '#7C3AED'
    });
    await dbSave();
  }
}

// Chiffre et sauvegarde (fire-and-forget, ne bloque pas l'UI)
function dbSave() {
  _encrypt(db).then(enc => localStorage.setItem(DB_KEY, enc)).catch(() => {
    localStorage.setItem(DB_KEY, JSON.stringify(db)); // fallback non chiffré
  });
  scheduleDriveSync();
  firebasePush(); // sync temps réel (no-op si Firebase non configuré)
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function now() { return new Date().toISOString(); }

// ═══════════════════════════════════════════
//   AUTH
// ═══════════════════════════════════════════
async function doLogin() {
  const btn = el('loginBtn');
  const u   = el('loginUser').value.trim().toLowerCase();
  const p   = el('loginPass').value;
  if (!u || !p) { showLoginError('Remplissez tous les champs'); return; }

  // ── Vérification verrouillage ──
  const lockKey  = 'rtp_lk_' + btoa(u);
  const lockData = JSON.parse(localStorage.getItem(lockKey) || '{}');
  if (lockData.until && Date.now() < lockData.until) {
    const mins = Math.ceil((lockData.until - Date.now()) / 60000);
    showLoginError(`Compte verrouillé — réessayez dans ${mins} min`);
    return;
  }

  btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true;
  try {
    const user = db.users.find(x =>
      x.username.toLowerCase() === u || (x.email && x.email.toLowerCase() === u)
    );
    const valid = user ? await verifyPwd(p, user.passwordHash, user.passwordSalt) : false;

    if (!valid) {
      const attempts = (lockData.attempts || 0) + 1;
      const remaining = 5 - attempts;
      if (remaining <= 0) {
        localStorage.setItem(lockKey, JSON.stringify({ attempts, until: Date.now() + 15 * 60000 }));
        showLoginError('5 tentatives échouées — compte verrouillé 15 minutes');
      } else {
        localStorage.setItem(lockKey, JSON.stringify({ attempts }));
        showLoginError(`Identifiant ou mot de passe incorrect (${remaining} tentative${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''})`);
      }
      return;
    }

    // ── Succès ──
    localStorage.removeItem(lockKey);
    user.lastLogin = now();
    dbSave();
    // Session dans sessionStorage (effacée à la fermeture du navigateur)
    session = { userId: user.id, token: uid(), at: Date.now() };
    sessionStorage.setItem(SES_KEY, JSON.stringify(session));
    addAuditLog('login', 'Connexion réussie depuis ' + (navigator.userAgent.includes('Mobile') ? 'mobile' : 'desktop'));
    dbSave();
    hideLoginError();
    startSessionTimer();
    if (user.mustChangePwd) {
      navigate('profile');
      openModal(`<div class="modal-title">🔒 Changez votre mot de passe</div>
        <p style="font-size:13px;color:var(--text2);margin-bottom:14px">Vous utilisez un mot de passe temporaire. Changez-le maintenant.</p>
        <div class="field"><label>Nouveau mot de passe (min 8 caractères)</label>
          <input id="p-pass" type="password" placeholder="Choisissez un mot de passe fort" oninput="updatePwdStrength(this.value)">
          ${pwdStrengthHtml('p-pass')}
        </div>
        <button class="btn btn-primary" onclick="forceChangePassword()">Confirmer</button>`);
    } else {
      navigate('dash');
      const welcomeKey = 'rtp_welcome_' + user.id;
      if (!localStorage.getItem(welcomeKey)) {
        localStorage.setItem(welcomeKey, '1');
        const role = ROLES[user.role] || { label: user.role, icon: '👤' };
        setTimeout(() => openModal(`
          <div class="modal-title">${role.icon} Bienvenue, ${user.name} !</div>
          <p style="font-size:13px;color:var(--text2);margin-bottom:16px">
            Vous êtes connecté en tant que <strong>${role.label}</strong>.<br>
            Un guide d'utilisation adapté à votre rôle est disponible.
          </p>
          <button class="btn btn-primary" onclick="downloadGuide('${user.role}');closeModal()" style="margin-bottom:10px">
            📖 Télécharger mon guide
          </button>
          <button class="btn" onclick="closeModal()" style="background:var(--bg3);color:var(--text1)">
            Plus tard (disponible dans Profil)
          </button>`), 400);
      }
    }
  } finally {
    btn.innerHTML = 'Se connecter'; btn.disabled = false;
  }
}

// ── Navigation entre panneaux login ──
function showLoginPanel() {
  el('loginPanel').style.display = '';
  el('forgotPanel').style.display = 'none';
  el('requestPanel').style.display = 'none';
}
function showForgotPanel() {
  el('loginPanel').style.display = 'none';
  el('forgotPanel').style.display = '';
  el('requestPanel').style.display = 'none';
  el('forgotResult').style.display = 'none';
  el('forgotError').classList.remove('show');
}
function showRequestPanel() {
  el('loginPanel').style.display = 'none';
  el('forgotPanel').style.display = 'none';
  el('requestPanel').style.display = '';
  el('requestSuccess').style.display = 'none';
  el('requestError').classList.remove('show');
}

// ── Mot de passe oublié (PBKDF2) ──
async function doForgotPassword() {
  const email = el('forgotEmail')?.value.trim().toLowerCase();
  const errEl = el('forgotError');
  if (!email || !email.includes('@')) {
    errEl.textContent = 'Email invalide'; errEl.classList.add('show'); return;
  }
  const user = db.users.find(u => u.email && u.email.toLowerCase() === email);
  if (!user) {
    errEl.textContent = 'Aucun compte associé à cet email'; errEl.classList.add('show'); return;
  }
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const tmp   = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const { hash, salt } = await hashPwdSafe(tmp);
  user.passwordHash = hash; user.passwordSalt = salt; user.mustChangePwd = true;
  addAuditLog('pwd_reset', `Réinitialisation mot de passe pour ${user.username}`);
  dbSave();
  el('forgotTempPwd').textContent = tmp;
  el('forgotResult').style.display = '';
  errEl.classList.remove('show');
}

// ── Changement forcé de mot de passe ──
async function forceChangePassword() {
  const pass = el('p-pass')?.value;
  if (!pass || pass.length < 8) { toast('Mot de passe trop court (min 8 caractères)', 'warning'); return; }
  if (pwdStrength(pass) < 2) { toast('Choisissez un mot de passe plus solide', 'warning'); return; }
  const user = me();
  const { hash, salt } = await hashPwdSafe(pass);
  user.passwordHash = hash; user.passwordSalt = salt; user.mustChangePwd = false;
  addAuditLog('pwd_change', 'Changement de mot de passe');
  dbSave(); closeModal();
  toast('Mot de passe mis à jour ✓', 'success');
  navigate('dash');
}

// ── Demande d'accès ──
function doRequestAccess() {
  const name  = el('reqName')?.value.trim();
  const email = el('reqEmail')?.value.trim().toLowerCase();
  const role  = el('reqRole')?.value;
  const errEl = el('requestError');

  if (!name)                      { errEl.textContent = 'Saisissez votre nom'; errEl.classList.add('show'); return; }
  if (!email || !email.includes('@')) { errEl.textContent = 'Email invalide'; errEl.classList.add('show'); return; }
  if (db.users.find(u => u.email && u.email.toLowerCase() === email)) {
    errEl.textContent = 'Un compte avec cet email existe déjà'; errEl.classList.add('show'); return;
  }
  if (db.pendingRequests.find(r => r.email === email)) {
    errEl.textContent = 'Une demande avec cet email est déjà en attente'; errEl.classList.add('show'); return;
  }

  db.pendingRequests.push({ id: uid(), name, email, role, requestedAt: now() });
  dbSave();
  el('requestSuccess').style.display = '';
  errEl.classList.remove('show');

  // Ouvre un email vers l'admin si son email est configuré
  const adminEmail = db.users.find(u => u.role === 'superadmin')?.email;
  if (adminEmail) {
    const subject = encodeURIComponent(`RénoTrace — Demande d'accès : ${name}`);
    const body = encodeURIComponent(`Bonjour,\n\n${name} (${email}) demande un accès en tant que ${role}.\n\nConnectez-vous à RénoTrace Pro pour approuver ou refuser cette demande.\n\nCordialement.`);
    window.open(`mailto:${adminEmail}?subject=${subject}&body=${body}`, '_blank');
  }
}
function doLogout() {
  if (!confirm('Se déconnecter ?')) return;
  session = null;
  localStorage.removeItem(SES_KEY);
  navigate('login');
}
function me() { return db.users.find(u => u.id === session?.userId) || null; }
function can(level) { const u = me(); return u && (ROLES[u.role]?.level || 0) >= level; }
function showLoginError(msg) { const e = el('loginError'); e.textContent = msg; e.classList.add('show'); }
function hideLoginError() { el('loginError').classList.remove('show'); }
function togglePwd() {
  const i = el('loginPass');
  i.type = i.type === 'password' ? 'text' : 'password';
}

// ═══════════════════════════════════════════
//   GPS
// ═══════════════════════════════════════════
function getGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject('GPS non disponible'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
      err => {
        navigator.geolocation.getCurrentPosition(
          pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
          () => reject('GPS indisponible'),
          { enableHighAccuracy: false, timeout: 8000 }
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}
async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, {
      headers: { 'User-Agent': 'RénoTracePro/2.0' }
    });
    const d = await r.json();
    const a = d.address;
    return [a.road, a.city || a.town || a.village || a.municipality].filter(Boolean).join(', ');
  } catch { return `${lat.toFixed(5)}, ${lng.toFixed(5)}`; }
}

// ═══════════════════════════════════════════
//   CAMERA
// ═══════════════════════════════════════════
async function startCamera() {
  if (!me()) return;
  // Fill chantier dropdown
  const sel = el('camChantier');
  const active = db.chantiers.filter(c => c.status !== 'termine');
  sel.innerHTML = active.length
    ? active.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
    : '<option value="">Aucun chantier actif</option>';
  // Set GPS
  el('camGpsTag').textContent = '📍 Localisation...';
  getGPS().then(async g => {
    currentGps = g;
    const addr = await reverseGeocode(g.lat, g.lng);
    el('camGpsTag').textContent = `📍 ${addr} (±${g.accuracy}m)`;
  }).catch(() => { el('camGpsTag').textContent = '📍 GPS indisponible'; });
  // Start video
  try {
    const constraints = { video: { facingMode: camFacing, width: { ideal: 1280 }, height: { ideal: 720 } } };
    camStream = await navigator.mediaDevices.getUserMedia(constraints);
    el('camVideo').srcObject = camStream;
  } catch {
    toast('Caméra non disponible — utilisez la galerie', 'warning');
  }
  navigate('camera');
}
function stopCamera() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  navigate('chantiers');
}
function flipCamera() {
  camFacing = camFacing === 'environment' ? 'user' : 'environment';
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); }
  startCamera();
}
async function capturePhoto() {
  const video = el('camVideo');
  const canvas = el('camCanvas');
  if (!video.srcObject && !el('camChantier').value) { toast('Aucun chantier sélectionné', 'warning'); return; }
  if (video.srcObject) {
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const data = canvas.toDataURL('image/jpeg', 0.85);
    await savePhoto(data);
  } else {
    toast('Caméra non disponible — utilisez la galerie', 'warning');
  }
}
function importPhoto() { el('photoInput').click(); }
async function handlePhotoImport(files) {
  for (const file of Array.from(files)) {
    const data = await new Promise(res => {
      const r = new FileReader();
      r.onload = e => res(e.target.result);
      r.readAsDataURL(file);
    });
    const compressed = await compressImage(data);
    await savePhoto(compressed);
  }
}
async function savePhoto(data) {
  const btn = el('camShoot'); btn.classList.add('loading-btn');
  const chantierId = el('camChantier').value;
  if (!chantierId) { toast('Sélectionnez un chantier', 'warning'); btn.classList.remove('loading-btn'); return; }
  const surface = document.querySelector('.pill.active')?.dataset.s || 'Autre';
  const note = el('camNote').value.trim();
  const thumb = await compressImage(data, 300);
  const fbThumb = await compressImage(data, 80); // miniature ultra-légère pour Firebase (~2KB)
  const photo = {
    id: uid(), chantierId, data, thumb, fbThumb,
    lat: currentGps?.lat, lng: currentGps?.lng, accuracy: currentGps?.accuracy,
    address: el('camGpsTag').textContent.replace('📍 ', ''),
    surface, note, takenBy: me().id, takenAt: now(),
  };
  db.photos.push(photo);
  // Update chantier
  const c = db.chantiers.find(x => x.id === chantierId);
  if (c) c.updatedAt = now();
  dbSave();
  toast('Photo enregistrée ✓', 'success');
  el('camNote').value = '';
  btn.classList.remove('loading-btn');
}
async function compressImage(dataUrl, maxW = 1400) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxW / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = img.width * ratio; canvas.height = img.height * ratio;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      res(canvas.toDataURL('image/jpeg', maxW <= 300 ? 0.6 : 0.82));
    };
    img.src = dataUrl;
  });
}

// ═══════════════════════════════════════════
//   AI — GROQ
// ═══════════════════════════════════════════
async function askAI(message, context = '') {
  const messages = [
    { role: 'system', content: `Tu es un assistant expert en gestion de chantiers de rénovation. Tu aides l'équipe de l'entreprise "${db.settings?.companyName || 'e-fficience'}". Sois concis, professionnel et utile. ${context}` },
    ...aiHistory.slice(-6),
    { role: 'user', content: message }
  ];
  // Pool de clés + clé perso en dernier recours
  const userKey = db.settings?.groqKey;
  const keys = [...GROQ_POOL];
  if (userKey && !keys.includes(userKey)) keys.push(userKey);
  for (let i = 0; i < keys.length; i++) {
    const idx = (groqPoolIdx + i) % keys.length;
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${keys[idx]}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages, max_tokens: 600, temperature: 0.7 })
      });
      if (r.status === 429) { groqPoolIdx = (idx + 1) % keys.length; continue; } // rate limit → clé suivante
      if (!r.ok) continue;
      const d = await r.json();
      groqPoolIdx = (idx + 1) % keys.length; // avance pour le prochain appel
      return d.choices?.[0]?.message?.content || 'Erreur de réponse IA';
    } catch { continue; }
  }
  return 'Toutes les clés API sont épuisées. Réessayez dans quelques minutes.';
}
async function sendAI() {
  const input = el('aiInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  appendAiMsg(msg, 'user');
  aiHistory.push({ role: 'user', content: msg });
  const context = buildAiContext();
  const thinking = appendAiMsg('...', 'bot');
  const reply = await askAI(msg, context);
  thinking.querySelector('.ai-bubble').textContent = reply || 'Erreur IA — réessayez dans quelques instants.';
  if (reply) aiHistory.push({ role: 'assistant', content: reply });
}
function buildAiContext() {
  const todayIso = new Date().toISOString().slice(0,10);
  const todayPhotos = db.photos.filter(p => p.takenAt?.startsWith(todayIso));
  const todayUsers = [...new Set(todayPhotos.map(p => getUserName(p.takenBy)))];
  const weekAgo = new Date(Date.now() - 7*86400000).toISOString();
  const openIssues = db.issues.filter(i => i.status !== 'resolved');

  const chantiersDetails = db.chantiers.map(c => {
    const photos = db.photos.filter(p => p.chantierId === c.id).length;
    const issues = db.issues.filter(i => i.chantierId === c.id && i.status !== 'resolved').length;
    const statusLabel = {en_cours:'En cours',termine:'Terminé',en_attente:'En attente',suspendu:'Suspendu'}[c.status] || c.status;
    return `  • ${c.name} — client: ${c.client} — statut: ${statusLabel} — avancement: ${c.progress||0}% — ${photos} photo(s) — ${issues} problème(s) ouvert(s)`;
  }).join('\n') || '  Aucun chantier';

  const issuesList = openIssues.map(i => {
    const c = db.chantiers.find(x => x.id === i.chantierId);
    const sev = {low:'Faible',medium:'Moyen',high:'Élevé',critical:'Critique'}[i.severity] || i.severity;
    return `  • "${i.title}" [${sev}] — chantier: ${c?.name||'?'} — signalé par: ${getUserName(i.createdBy)}`;
  }).join('\n') || '  Aucun problème ouvert';

  const todayPhotosList = todayPhotos.map(p => {
    const c = db.chantiers.find(x => x.id === p.chantierId);
    return `  • ${getUserName(p.takenBy)} — chantier: ${c?.name||'?'} — surface: ${p.surface} — ${p.address||''} — à ${formatTime(p.takenAt)}`;
  }).join('\n') || '  Aucune photo aujourd\'hui';

  return `=== Données RénoTrace Pro — ${db.settings?.companyName||'Mon Entreprise'} ===
Date: ${new Date().toLocaleDateString('fr-FR', {weekday:'long',day:'numeric',month:'long',year:'numeric'})}

STATISTIQUES:
• ${db.chantiers.length} chantier(s) au total (${db.chantiers.filter(c=>c.status==='en_cours').length} en cours)
• ${db.photos.length} photos au total — ${db.photos.filter(p=>p.takenAt>weekAgo).length} cette semaine — ${todayPhotos.length} aujourd'hui
• ${db.users.length} utilisateur(s) — ${openIssues.length} problème(s) ouvert(s)

PERSONNES ACTIVES AUJOURD'HUI:
${todayUsers.length ? todayUsers.map(u=>'  • '+u).join('\n') : '  Personne n\'a encore pris de photo aujourd\'hui'}

PHOTOS D'AUJOURD'HUI:
${todayPhotosList}

CHANTIERS:
${chantiersDetails}

PROBLÈMES OUVERTS:
${issuesList}`;
}
function appendAiMsg(text, role) {
  const div = document.createElement('div');
  div.className = `ai-msg ${role}`;
  div.innerHTML = `<div class="ai-bubble">${text}</div><div class="ai-time">${new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>`;
  el('aiMessages').appendChild(div);
  el('aiMessages').scrollTop = el('aiMessages').scrollHeight;
  return div;
}
function clearAiChat() { el('aiMessages').innerHTML = ''; aiHistory = []; renderAiPrompts(); }

// ═══════════════════════════════════════════
//   GOOGLE DRIVE
// ═══════════════════════════════════════════
function scheduleDriveSync() {
  if (!db.settings?.driveClientId || !driveToken) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(driveSync, 2500);
}
function driveConnect() {
  const clientId = db.settings?.driveClientId;
  if (!clientId) { toast('Configurez d\'abord votre Client ID Google Drive', 'warning'); return; }
  const redirect = encodeURIComponent(location.origin + location.pathname);
  const scope = encodeURIComponent('https://www.googleapis.com/auth/drive.file');
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirect}&response_type=token&scope=${scope}`;
  window.open(url, '_blank', 'width=500,height=600');
}
function checkDriveToken() {
  const hash = location.hash;
  if (hash.includes('access_token')) {
    const params = new URLSearchParams(hash.slice(1));
    driveToken = params.get('access_token');
    db.settings.driveToken = driveToken;
    dbSave();
    location.hash = '';
    toast('Google Drive connecté ✓', 'success');
  } else if (db.settings?.driveToken) {
    driveToken = db.settings.driveToken;
  }
}
async function driveSync() {
  if (!driveToken) return;
  try {
    const content = JSON.stringify(db);
    const blob = new Blob([content], { type: 'application/json' });
    const metadata = { name: 'renotrace-pro-data.json', mimeType: 'application/json' };
    // Check if file exists
    const search = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='renotrace-pro-data.json'&spaces=drive`, {
      headers: { 'Authorization': `Bearer ${driveToken}` }
    });
    const found = await search.json();
    const fileId = found.files?.[0]?.id;
    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    formData.append('file', blob);
    const url = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    await fetch(url, {
      method: fileId ? 'PATCH' : 'POST',
      headers: { 'Authorization': `Bearer ${driveToken}` },
      body: formData
    });
    db.settings.lastSync = now();
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    updateDriveStatus('synced');
  } catch { updateDriveStatus('error'); }
}
function updateDriveStatus(state) {
  const dot = document.querySelector('.drive-dot');
  if (!dot) return;
  dot.className = `drive-dot ${state}`;
}

// ═══════════════════════════════════════════
//   FIREBASE — Sync temps réel entre appareils
// ═══════════════════════════════════════════
const _FB_CFG = {
  apiKey:            'AIzaSyDnbkuxQtHf8JDZc9p9KDQWxau8fedLY-M',
  authDomain:        'renotrace-74aab.firebaseapp.com',
  projectId:         'renotrace-74aab',
  storageBucket:     'renotrace-74aab.firebasestorage.app',
  messagingSenderId: '680331133670',
  appId:             '1:680331133670:web:905f555ee117970e9d7127',
};

function firebaseInit() {
  if (typeof firebase === 'undefined') return;
  try {
    if (!firebase.apps.length) firebase.initializeApp(_FB_CFG);
    fbDb = firebase.firestore();
    if (!fbListening) { fbListening = true; firebaseListen(); }
    updateFirebaseStatus('connected');
  } catch { updateFirebaseStatus('error'); }
}

async function firebasePush() {
  if (!fbDb) return;
  // Photos : on envoie uniquement les métadonnées + miniature (pas le full-res)
  const slimPhotos = (db.photos || []).map(p => ({
    id: p.id, chantierId: p.chantierId, takenBy: p.takenBy,
    takenAt: p.takenAt, surface: p.surface, address: p.address, note: p.note || null,
    gps: p.gps || null, thumb: p.thumb || p.fbThumb || null, // 300px pour meilleure qualité
  }));
  const slim = { ...db, photos: slimPhotos, _fbPushTs: Date.now() };
  try {
    await fbDb.collection('renotrace').doc('shared').set({
      data: JSON.stringify(slim),
      ts: Date.now(),
    });
  } catch {}
}

function firebaseListen() {
  if (!fbDb) return;
  fbDb.collection('renotrace').doc('shared').onSnapshot(snap => {
    if (!snap.exists) return;
    const remote = snap.data();
    if (!remote?.data) return;
    try {
      const remoteDb = JSON.parse(remote.data);
      const localTs = db.settings?._fbLastRemote || 0;
      // Ignore si c'est notre propre push récent (évite la boucle)
      if (remote.ts <= localTs + 1500) return;
      // Merge photos : garde le full-res local si dispo, sinon prend la miniature distante
      const localPhotoMap = Object.fromEntries((db.photos || []).map(p => [p.id, p]));
      const mergedPhotos = (remoteDb.photos || []).map(rp => {
        const local = localPhotoMap[rp.id];
        return local?.data ? local : { ...rp }; // full-res local prioritaire
      });
      // Ajoute les photos locales non présentes dans remote (prises sur cet appareil)
      for (const lp of (db.photos || [])) {
        if (!mergedPhotos.find(p => p.id === lp.id)) mergedPhotos.push(lp);
      }
      Object.assign(db, remoteDb);
      db.photos = mergedPhotos;
      db.settings._fbLastRemote = remote.ts;
      _encrypt(db).then(enc => localStorage.setItem(DB_KEY, enc)).catch(() => {
        localStorage.setItem(DB_KEY, JSON.stringify(db));
      });
      if (session) rerenderCurrent();
      updateFirebaseStatus('connected');
    } catch {}
  });
}

function rerenderCurrent() {
  const map = {
    dashScreen: () => renderDash?.(),
    chantiersScreen: () => renderChantiers?.(),
    adminScreen: () => renderAdmin?.(),
  };
  for (const [id, fn] of Object.entries(map)) {
    if (document.getElementById(id)?.classList.contains('active')) { fn(); break; }
  }
}

function updateFirebaseStatus(state) {
  const dot = document.querySelector('.firebase-dot');
  if (!dot) return;
  dot.className = `firebase-dot ${state}`;
  const label = { connected: '✅ Connecté', error: '❌ Erreur', pending: '⏳ Connexion...' };
  const txt = document.querySelector('.firebase-status-txt');
  if (txt) txt.textContent = label[state] || '';
}

function saveFirebaseConfig() {
  const key  = el('fbApiKey')?.value?.trim();
  const proj = el('fbProjectId')?.value?.trim();
  if (!key || !proj) { toast('Remplissez les deux champs', 'warning'); return; }
  db.settings.fbApiKey    = key;
  db.settings.fbProjectId = proj;
  db.settings.fbAuthDomain = proj + '.firebaseapp.com';
  dbSave();
  // (Re)init Firebase avec la nouvelle config
  fbDb = null; fbListening = false;
  firebaseInit();
  toast('Configuration Firebase enregistrée', 'success');
  renderAdmin();
}

// ═══════════════════════════════════════════
//   EXPORT
// ═══════════════════════════════════════════
function exportJson() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `renotrace-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
  toast('Export téléchargé', 'success');
}
function importJson(file) {
  const r = new FileReader();
  r.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.users || !data.chantiers) { toast('Fichier invalide', 'error'); return; }
      db = data;
      dbSave();
      toast('Données importées ✓', 'success');
      renderAdmin();
    } catch { toast('Erreur import', 'error'); }
  };
  r.readAsText(file);
}
function exportChantierHtml(chantierId) {
  const c = db.chantiers.find(x => x.id === chantierId);
  if (!c) return;
  const photos = db.photos.filter(p => p.chantierId === chantierId);
  const byDay = groupByDay(photos);
  const daysHtml = Object.entries(byDay).map(([day, ps]) => `
    <h3 style="margin:20px 0 10px;font-size:16px;color:#0F172A;border-bottom:2px solid #E2E8F0;padding-bottom:6px">📅 ${day}</h3>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
      ${ps.map(p => `<div style="break-inside:avoid">
        <img src="${p.data}" style="width:100%;border-radius:8px;margin-bottom:4px">
        <div style="font-size:11px;color:#475569">${p.surface} — ${p.address || ''}<br>Par ${getUserName(p.takenBy)} — ${formatTime(p.takenAt)}</div>
      </div>`).join('')}
    </div>`).join('');
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Rapport — ${c.name}</title>
    <style>body{font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:20px;color:#0F172A}
    h1{font-size:24px;margin-bottom:4px} .meta{color:#475569;font-size:13px;margin-bottom:20px}</style>
    </head><body>
    <h1>🏗️ ${c.name}</h1>
    <div class="meta">Client : ${c.client} | Adresse : ${c.address} | Type : ${c.type}<br>
    Avancement : ${c.progress || 0}% | Photos : ${photos.length} | Généré le ${new Date().toLocaleDateString('fr-FR')}</div>
    ${daysHtml}
    <p style="margin-top:30px;font-size:11px;color:#94A3B8;border-top:1px solid #E2E8F0;padding-top:10px">
    Rapport généré par RénoTrace Pro v${APP_VER} — ${db.settings.companyName}</p>
    </body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `rapport-${c.name.replace(/\s+/g,'-').toLowerCase()}-${new Date().toISOString().slice(0,10)}.html`;
  a.click(); URL.revokeObjectURL(url);
  toast('Rapport téléchargé', 'success');
}

// ═══════════════════════════════════════════
//   UI HELPERS
// ═══════════════════════════════════════════
function el(id) { return document.getElementById(id); }
function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  t.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${msg}`;
  el('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function openModal(html) {
  el('modalBox').innerHTML = `<div class="modal-handle"></div>${html}`;
  el('modalOverlay').classList.add('open');
}
function closeModal(e) { if (!e || e.target === el('modalOverlay')) el('modalOverlay').classList.remove('open'); }
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'à l\'instant';
  if (m < 60) return `il y a ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  return `il y a ${Math.floor(h / 24)}j`;
}
function groupByDay(photos) {
  const out = {};
  photos.sort((a,b) => new Date(b.takenAt) - new Date(a.takenAt));
  photos.forEach(p => {
    const day = new Date(p.takenAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    if (!out[day]) out[day] = [];
    out[day].push(p);
  });
  return out;
}
function getUserName(id) { return db.users.find(u => u.id === id)?.name || 'Inconnu'; }
function avatarInitials(name) { return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2); }
function progressColor(p) { return p >= 80 ? 'green' : p >= 40 ? '' : 'orange'; }
function statusBadge(status) {
  const map = {
    en_cours:  ['badge-blue', '🔵 En cours'],
    termine:   ['badge-green', '✅ Terminé'],
    en_attente:['badge-gray', '⏸ En attente'],
    suspendu:  ['badge-red', '🔴 Suspendu'],
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

// ═══════════════════════════════════════════
//   ROUTER
// ═══════════════════════════════════════════
const SCREENS = ['login','dash','chantiers','chantier','camera','ai','admin','profile'];
function navigate(screen, data = null) {
  // Stop camera when leaving
  if (screen !== 'camera' && camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  SCREENS.forEach(s => el(s + 'Screen')?.classList.remove('active'));
  el(screen + 'Screen')?.classList.add('active');
  // Update nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navMap = { dash: 'dash', chantiers: 'chantiers', ai: 'ai', profile: 'profile' };
  if (navMap[screen]) document.querySelector(`[data-nav="${navMap[screen]}"]`)?.classList.add('active');
  // Show/hide bottom nav
  const hideNav = ['login','camera'];
  el('bottomNav').style.display = hideNav.includes(screen) ? 'none' : 'flex';
  // Render
  const renders = { dash: renderDash, chantiers: renderChantiers, ai: renderAI, admin: renderAdmin, profile: renderProfile };
  if (renders[screen]) renders[screen]();
  if (screen === 'chantier' && data) renderChantier(data);
}

// ═══════════════════════════════════════════
//   SCREEN: DASHBOARD
// ═══════════════════════════════════════════
function renderDash() {
  const user = me();
  if (!user) return;
  const today = new Date().toISOString().slice(0,10);
  const todayPhotos = db.photos.filter(p => p.takenAt?.startsWith(today)).length;
  const activeChantiers = db.chantiers.filter(c => c.status === 'en_cours').length;
  const totalPhotos = db.photos.length;
  const usersActive = new Set(db.photos.filter(p => p.takenAt?.startsWith(today)).map(p => p.takenBy)).size;
  const weekAgo = new Date(Date.now() - 7*86400000).toISOString();
  const weekPhotos = db.photos.filter(p => p.takenAt > weekAgo).length;

  // Update avatar
  el('avatarBtn').textContent = avatarInitials(user.name);
  el('avatarBtn').style.background = user.avatarColor || '#2563EB';

  const days = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const d = new Date();
  const dateStr = `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;

  const activeList = db.chantiers.filter(c => c.status === 'en_cours').slice(0,3);
  const activeHtml = activeList.length ? activeList.map(c => {
    const photos = db.photos.filter(p => p.chantierId === c.id).length;
    const pct = c.progress || 0;
    return `<div class="chantier-card" onclick="navigate('chantier','${c.id}')">
      <div class="chantier-card-top">
        <div>
          <div class="chantier-name">${c.name}</div>
          <div class="chantier-client">${c.client}</div>
        </div>
        ${statusBadge(c.status)}
      </div>
      <div class="progress-wrap">
        <div class="progress-label">
          <span class="progress-text">Avancement</span>
          <span class="progress-pct">${pct}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill ${progressColor(pct)}" style="width:${pct}%"></div></div>
      </div>
      <div class="chantier-meta">
        <span class="chantier-stat">📸 ${photos} photos</span>
        <span class="chantier-stat">🕐 ${timeAgo(c.updatedAt || c.createdAt)}</span>
      </div>
    </div>`;
  }).join('') : `<div class="empty"><div class="empty-icon">🏗️</div><div class="empty-title">Aucun chantier actif</div><button class="btn btn-primary mt-12" onclick="showAddChantier()">+ Créer un chantier</button></div>`;

  // Recent activity
  const recent = db.photos.slice(-5).reverse();
  const actHtml = recent.map(p => {
    const c = db.chantiers.find(x => x.id === p.chantierId);
    const u = db.users.find(x => x.id === p.takenBy);
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s" onclick="viewActivityPhoto('${p.id}','${p.chantierId}')" onmousedown="this.style.background='var(--bg)'" onmouseup="this.style.background=''">
      <img src="${p.thumb||p.data||p.fbThumb}" style="width:46px;height:46px;border-radius:10px;object-fit:cover;flex-shrink:0">
      <div style="flex:1;overflow:hidden">
        <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c?.name || 'Chantier supprimé'}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">${p.surface} — <span style="font-weight:700">${u?.name || '?'}</span></div>
        <div style="font-size:10px;color:var(--text3);margin-top:1px">${p.address || ''}</div>
      </div>
      <div style="font-size:11px;color:var(--text3);flex-shrink:0;text-align:right">${timeAgo(p.takenAt)}<br><span style="font-size:10px">›</span></div>
    </div>`;
  }).join('') || '<div class="text-muted" style="font-size:13px;padding:12px 0">Aucune activité récente</div>';

  el('dashBody').innerHTML = `
    <div class="greeting">
      <div class="greeting-name">Bonjour, ${user.name.split(' ')[0]} 👋</div>
      <div class="greeting-date">${dateStr}</div>
    </div>
    <div class="stats-grid">
      <div class="stat-card stat-card-link" onclick="navigateDashStat('chantiers')">
        <div class="stat-icon">🏗️</div>
        <div class="stat-value">${activeChantiers}</div>
        <div class="stat-label">Chantiers actifs</div>
      </div>
      <div class="stat-card stat-card-link" onclick="navigateDashStat('photos')">
        <div class="stat-icon">📸</div>
        <div class="stat-value">${todayPhotos}</div>
        <div class="stat-label">Photos aujourd'hui</div>
      </div>
      <div class="stat-card stat-card-link" onclick="navigateDashStat('users')">
        <div class="stat-icon">👷</div>
        <div class="stat-value">${usersActive}</div>
        <div class="stat-label">Actifs aujourd'hui</div>
      </div>
      <div class="stat-card stat-card-link" onclick="navigateDashStat('week')">
        <div class="stat-icon">📊</div>
        <div class="stat-value">${weekPhotos}</div>
        <div class="stat-label">Cette semaine</div>
      </div>
    </div>
    <div class="section-title">Chantiers en cours</div>
    ${activeHtml}
    <div class="section-title">📋 Tâches</div>
    <div class="card">
      <div id="taskList"></div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input id="taskInput" type="text" placeholder="Ajouter une tâche..." style="flex:1;padding:10px 14px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;background:var(--bg);outline:none;font-family:'Plus Jakarta Sans',sans-serif" onkeydown="if(event.key==='Enter')addTask()">
        <button onclick="addTask()" style="background:var(--blue);color:white;border:none;border-radius:10px;padding:0 18px;height:44px;font-size:20px;font-weight:700;cursor:pointer;flex-shrink:0;transition:background .15s" onmousedown="this.style.background='var(--blue-d)'" onmouseup="this.style.background='var(--blue)'">＋</button>
      </div>
    </div>
    ${can(3) ? `<div class="section-title">Activité récente</div>
    <div class="card">${actHtml}</div>` : ''}
  `;
  renderTaskList();
}

// ═══════════════════════════════════════════
//   SCREEN: CHANTIERS
// ═══════════════════════════════════════════
function renderChantiers(filter) {
  if (filter === undefined) filter = el('chantiersSearchInput')?.value || '';
  const all = db.chantiers.filter(c =>
    !filter || c.name.toLowerCase().includes(filter.toLowerCase()) || c.client.toLowerCase().includes(filter.toLowerCase())
  );
  const html = all.length ? all.map(c => {
    const photos = db.photos.filter(p => p.chantierId === c.id).length;
    const issues = db.issues.filter(i => i.chantierId === c.id && i.status !== 'resolved').length;
    const pct = c.progress || 0;
    return `<div class="chantier-card" onclick="navigate('chantier','${c.id}')">
      <div class="chantier-card-top">
        <div style="flex:1;min-width:0">
          <div class="chantier-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</div>
          <div class="chantier-client">${c.client}</div>
          <div class="chantier-address">📍 ${c.address}</div>
        </div>
        <div style="flex-shrink:0;margin-left:8px">${statusBadge(c.status)}</div>
      </div>
      <div class="progress-wrap">
        <div class="progress-label">
          <span class="progress-text">Avancement</span>
          <span class="progress-pct">${pct}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill ${progressColor(pct)}" style="width:${pct}%"></div></div>
      </div>
      <div class="chantier-meta">
        <span class="chantier-stat">📸 ${photos}</span>
        ${issues ? `<span class="chantier-stat" style="color:var(--red)">⚠ ${issues}</span>` : ''}
        <span class="chantier-stat">🕐 ${timeAgo(c.updatedAt || c.createdAt)}</span>
        <span class="chantier-stat" style="color:var(--text3)">${c.type}</span>
      </div>
    </div>`;
  }).join('') : `<div class="empty"><div class="empty-icon">🏗️</div><div class="empty-title">Aucun chantier</div>
    ${can(2) ? '<button class="btn btn-primary mt-12" onclick="showAddChantier()">+ Créer un chantier</button>' : ''}</div>`;

  el('chantiersBody').innerHTML = html;
  el('addChantierBtn').style.display = can(2) ? 'flex' : 'none';
}

// ═══════════════════════════════════════════
//   SCREEN: CHANTIER DÉTAIL
// ═══════════════════════════════════════════
function renderChantier(id) {
  currentChantier = id;
  const c = db.chantiers.find(x => x.id === id);
  if (!c) { navigate('chantiers'); return; }
  el('chantierTitle').textContent = c.name;
  el('chantierMenuBtn').onclick = () => showChantierMenu(id);

  const photos = db.photos.filter(p => p.chantierId === id);
  const issues = db.issues.filter(i => i.chantierId === id);
  const byDay = groupByDay(photos);
  const pct = c.progress || 0;

  const photosHtml = Object.keys(byDay).length ? Object.entries(byDay).map(([day, ps]) => `
    <div class="photo-day">
      <div class="photo-day-header">
        <span>${day}</span>
        <span style="font-weight:500;text-transform:none">${ps.length} photo${ps.length > 1 ? 's' : ''}</span>
      </div>
      <div class="photo-grid">
        ${ps.map(p => `<div class="photo-thumb" onclick="openLightbox('${p.id}')">
          <img src="${p.thumb || p.data || p.fbThumb}" loading="lazy" alt="${p.surface}">
        </div>`).join('')}
      </div>
    </div>`).join('') : `<div class="empty"><div class="empty-icon">📸</div><div class="empty-title">Aucune photo</div><div class="empty-text">Prenez des photos avec le bouton caméra</div></div>`;

  const issuesHtml = issues.length ? issues.map(i => `
    <div class="issue-item">
      <div class="issue-title">${i.title}</div>
      <div class="issue-desc">${i.description || ''}</div>
      <div class="issue-meta">
        <span class="badge ${i.severity === 'high' || i.severity === 'critical' ? 'badge-red' : i.severity === 'medium' ? 'badge-orange' : 'badge-gray'}">${{low:'Faible',medium:'Moyen',high:'Élevé',critical:'Critique'}[i.severity]||i.severity}</span>
        <span class="badge ${i.status === 'resolved' ? 'badge-green' : i.status === 'in_progress' ? 'badge-blue' : 'badge-gray'}">${{open:'Ouvert',in_progress:'En cours',resolved:'Résolu'}[i.status]||i.status}</span>
        <span style="font-size:11px;color:var(--text3)">${formatTime(i.createdAt)}</span>
      </div>
    </div>`).join('') : `<div class="empty"><div class="empty-icon">✅</div><div class="empty-title">Aucun problème signalé</div></div>`;

  el('chantierBody').innerHTML = `
    <div class="chantier-hero">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
        <div>
          <div class="chantier-hero-name">${c.name}</div>
          <div class="chantier-hero-client">Client : ${c.client}</div>
          <div class="chantier-hero-address">📍 ${c.address}</div>
        </div>
      </div>
      <div class="chantier-hero-badges">
        ${statusBadge(c.status)}
        <span class="badge badge-gray">${c.type}</span>
        <span class="badge badge-gray">📸 ${photos.length}</span>
      </div>
      <div class="chantier-hero-progress">
        <div class="chantier-hero-pct-label">Avancement</div>
        <div class="chantier-hero-pct">${pct}%</div>
        <div class="progress-bar-white" style="margin-top:6px">
          <div class="progress-fill-white" style="width:${pct}%"></div>
        </div>
      </div>
    </div>
    <div class="tabs" style="margin-bottom:16px">
      <button class="tab active" onclick="switchTab(this,'tab-photos')">📸 Photos (${photos.length})</button>
      <button class="tab" onclick="switchTab(this,'tab-issues')">⚠️ Problèmes (${issues.length})</button>
      <button class="tab" onclick="switchTab(this,'tab-info')">ℹ️ Infos</button>
    </div>
    <div id="tab-photos">${photosHtml}</div>
    <div id="tab-issues" style="display:none">
      ${can(2) ? `<button class="btn btn-secondary btn-sm" style="margin-bottom:12px" onclick="showAddIssue('${id}')">+ Signaler un problème</button>` : ''}
      ${issuesHtml}
    </div>
    <div id="tab-info" style="display:none">
      <div class="card">
        <div style="display:flex;flex-direction:column;gap:10px">
          ${infoRow('Client', c.client)}
          ${infoRow('Adresse', c.address)}
          ${infoRow('Type de travaux', c.type)}
          ${infoRow('Statut', c.status)}
          ${infoRow('Avancement', pct + '%')}
          ${infoRow('Date de début', c.startDate ? formatDate(c.startDate) : '—')}
          ${infoRow('Date de fin prévue', c.endDate ? formatDate(c.endDate) : '—')}
          ${c.notes ? infoRow('Notes', c.notes) : ''}
        </div>
      </div>
      ${can(2) ? `<div class="btn-row" style="margin-top:12px">
        <button class="btn btn-secondary btn-sm" onclick="showEditChantier('${id}')">✏️ Modifier</button>
        <button class="btn btn-secondary btn-sm" onclick="exportChantierHtml('${id}')">📄 Rapport</button>
      </div>` : ''}
      ${can(3) ? `<button class="btn btn-danger btn-sm" style="margin-top:8px" onclick="deleteChantier('${id}')">Supprimer le chantier</button>` : ''}
    </div>
    <div id="lightboxEl" class="lightbox">
      <button class="lightbox-close" onclick="closeLightbox()">✕</button>
      <img class="lightbox-img" id="lightboxImg">
      <div class="lightbox-info" id="lightboxInfo"></div>
    </div>
  `;
}
function infoRow(label, value) {
  return `<div style="display:flex;gap:8px"><span style="font-size:12px;font-weight:700;color:var(--text2);min-width:110px">${label}</span><span style="font-size:14px;font-weight:500">${value}</span></div>`;
}
function switchTab(btn, tabId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  ['tab-photos','tab-issues','tab-info'].forEach(id => {
    const el2 = document.getElementById(id);
    if (el2) el2.style.display = id === tabId ? '' : 'none';
  });
}
function openLightbox(photoId) {
  const p = db.photos.find(x => x.id === photoId);
  if (!p) return;
  const lb = document.getElementById('lightboxEl');
  const bestSrc = p.data || p.thumb || p.fbThumb || '';
  el('lightboxImg').src = bestSrc;
  const lowRes = !p.data && (p.thumb || p.fbThumb);
  el('lightboxInfo').innerHTML = `${p.surface} — ${p.address}<br>${getUserName(p.takenBy)} — ${formatDate(p.takenAt)} ${formatTime(p.takenAt)}${p.note ? '<br><em>' + p.note + '</em>' : ''}${lowRes ? '<br><span style="font-size:11px;opacity:.6">⚠ Aperçu basse résolution — photo complète sur l\'appareil source</span>' : ''}
    <br><div style="display:flex;gap:8px;justify-content:center;margin-top:10px;flex-wrap:wrap">
      <button style="padding:8px 16px;background:var(--blue);color:white;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer" onclick="downloadPhoto('${p.id}')">⬇ Télécharger</button>
      ${can(2) ? `<button style="padding:8px 16px;background:var(--red);color:white;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer" onclick="deletePhoto('${p.id}')">🗑 Supprimer</button>` : ''}
    </div>`;
  lb.classList.add('open');
  el('bottomNav').style.display = 'none';
}
function downloadPhoto(photoId) {
  const p = db.photos.find(x => x.id === photoId);
  if (!p) return;
  const src = p.data || p.thumb || p.fbThumb;
  if (!src) { toast('Image non disponible pour téléchargement', 'warning'); return; }
  const c = db.chantiers.find(x => x.id === p.chantierId);
  const date = new Date(p.takenAt).toLocaleDateString('fr-FR').replace(/\//g, '-');
  const filename = `${(c?.name || 'photo').replace(/\s+/g,'_')}-${p.surface}-${date}.jpg`;
  const a = document.createElement('a');
  a.href = src;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('Photo téléchargée ✓', 'success');
}
function closeLightbox() { document.getElementById('lightboxEl')?.classList.remove('open'); el('bottomNav').style.display = 'flex'; }
function deletePhoto(id) {
  if (!confirm('Supprimer cette photo ?')) return;
  db.photos = db.photos.filter(p => p.id !== id);
  dbSave();
  closeLightbox();
  toast('Photo supprimée', 'success');
  renderChantier(currentChantier);
}

// ═══════════════════════════════════════════
//   SCREEN: AI
// ═══════════════════════════════════════════
function renderAI() {
  renderAiPrompts();
  if (!el('aiMessages').children.length) {
    appendAiMsg(`Bonjour ${me()?.name?.split(' ')[0] || ''} ! 👋 Je suis votre assistant IA pour la gestion des chantiers. Posez-moi une question ou choisissez un raccourci ci-dessous.`, 'bot');
  }
  // L'IA est active via le pool de clés intégré — pas besoin d'avertissement
}
function renderAiPrompts() {
  const prompts = [
    'Résumé des chantiers',
    'Qui a pris des photos aujourd\'hui ?',
    'Chantier le plus avancé ?',
    'Problèmes non résolus ?',
    'Générer rapport hebdo',
  ];
  el('aiPrompts').innerHTML = prompts.map(p =>
    `<button class="ai-prompt-chip" onclick="usePrompt(this.textContent)">${p}</button>`
  ).join('');
}
function usePrompt(text) { el('aiInput').value = text; sendAI(); }

// ═══════════════════════════════════════════
//   SCREEN: PROFILE + SETTINGS
// ═══════════════════════════════════════════
function renderProfile() {
  const user = me();
  if (!user) return;
  const myPhotos = db.photos.filter(p => p.takenBy === user.id).length;
  const role = ROLES[user.role] || {};
  const driveConnected = !!driveToken;
  el('profileBody').innerHTML = `
    <div class="profile-header">
      <div class="profile-avatar" style="background:${user.avatarColor}">${avatarInitials(user.name)}</div>
      <div class="profile-name">${user.name}</div>
      <div class="profile-role">${role.icon || ''} ${role.label || user.role}</div>
    </div>
    <div class="stats-grid" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-icon">📸</div><div class="stat-value">${myPhotos}</div><div class="stat-label">Mes photos</div></div>
      <div class="stat-card"><div class="stat-icon">🕐</div><div class="stat-value">${user.lastLogin ? timeAgo(user.lastLogin) : '—'}</div><div class="stat-label">Dernière connexion</div></div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Mon compte</div>
      <div class="settings-row">
        <div class="settings-item" onclick="showEditProfile()">
          <span class="settings-icon">✏️</span>
          <div class="settings-label"><div class="settings-name">Modifier mon profil</div><div class="settings-desc">Nom, mot de passe</div></div>
          <span class="settings-arrow">›</span>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Configuration</div>
      <div class="settings-row">
        <div class="settings-item" onclick="showDriveSettings()">
          <span class="settings-icon">☁️</span>
          <div class="settings-label"><div class="settings-name">Google Drive</div><div class="settings-desc">${driveConnected ? '✓ Connecté' : 'Non connecté'}</div></div>
          <span class="settings-arrow">›</span>
        </div>
        ${can(4) ? `<div class="settings-item" onclick="showCompanySettings()">
          <span class="settings-icon">🏢</span>
          <div class="settings-label"><div class="settings-name">Entreprise</div><div class="settings-desc">${db.settings.companyName}</div></div>
          <span class="settings-arrow">›</span>
        </div>` : ''}
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">📚 Guide d'utilisation</div>
      <div class="settings-row">
        <div class="settings-item" onclick="downloadGuide('${user.role}')">
          <span class="settings-icon">📖</span>
          <div class="settings-label"><div class="settings-name">Mon guide (${role.label || user.role})</div><div class="settings-desc">Télécharger le guide adapté à mon rôle</div></div>
          <span class="settings-arrow">↓</span>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Données</div>
      <div class="settings-row">
        <div class="settings-item" onclick="exportJson()">
          <span class="settings-icon">💾</span>
          <div class="settings-label"><div class="settings-name">Exporter les données</div><div class="settings-desc">Fichier JSON de sauvegarde</div></div>
          <span class="settings-arrow">↓</span>
        </div>
        <div class="settings-item" onclick="el('importInput').click()">
          <span class="settings-icon">📂</span>
          <div class="settings-label"><div class="settings-name">Importer des données</div><div class="settings-desc">Restaurer depuis un fichier JSON</div></div>
          <span class="settings-arrow">↑</span>
        </div>
      </div>
    </div>
    ${can(5) ? `<div class="settings-section">
      <div class="settings-section-title">Administration</div>
      <div class="settings-row">
        <div class="settings-item" onclick="navigate('admin')">
          <span class="settings-icon">🛡️</span>
          <div class="settings-label"><div class="settings-name">Panel Super Admin</div><div class="settings-desc">Utilisateurs, stats, sauvegarde</div></div>
          <span class="settings-arrow">›</span>
        </div>
      </div>
    </div>` : ''}
    <button class="btn btn-danger" style="margin-top:8px" onclick="doLogout()">⏻ Se déconnecter</button>
    <div style="text-align:center;font-size:11px;color:var(--text3);margin-top:16px">RénoTrace Pro v${APP_VER}</div>
    <input type="file" id="importInput" accept=".json" style="display:none" onchange="importJson(this.files[0])">
  `;
}

// ═══════════════════════════════════════════
//   SCREEN: ADMIN
// ═══════════════════════════════════════════
function renderAdmin() {
  if (!can(4)) { navigate('profile'); return; }
  const today = new Date().toISOString().slice(0,10);
  const todayPhotos = db.photos.filter(p => p.takenAt?.startsWith(today)).length;
  const noPhotoToday = db.users.filter(u => u.role !== 'superadmin' && !db.photos.some(p => p.takenBy === u.id && p.takenAt?.startsWith(today)));

  el('adminBody').innerHTML = `
    <div class="tabs admin-tabs" style="margin:-16px -16px 16px;padding:0 16px">
      <button class="tab active" onclick="switchAdminTab(this,'at-overview')">Vue d'ensemble</button>
      <button class="tab" onclick="switchAdminTab(this,'at-users')">Opérateurs</button>
      <button class="tab" onclick="switchAdminTab(this,'at-requests')">Demandes ${db.pendingRequests.length ? `<span style="background:var(--red);color:white;border-radius:50px;padding:1px 6px;font-size:10px;margin-left:4px">${db.pendingRequests.length}</span>` : ''}</button>
      <button class="tab" onclick="switchAdminTab(this,'at-trace')">Traçabilité</button>
      <button class="tab" onclick="switchAdminTab(this,'at-backup')">Sauvegarde</button>
      <button class="tab" onclick="switchAdminTab(this,'at-audit')">🔍 Journal</button>
      <button class="tab" onclick="switchAdminTab(this,'at-tasks')">📋 Tâches</button>
      <button class="tab" onclick="switchAdminTab(this,'at-issues')">⚠️ Problèmes${db.issues.filter(i=>i.status==='open').length ? `<span style="background:var(--red);color:white;border-radius:50px;padding:1px 6px;font-size:10px;margin-left:4px">${db.issues.filter(i=>i.status==='open').length}</span>` : ''}</button>
    </div>

    <div id="at-overview">
      <div class="stats-grid">
        <div class="stat-card stat-card-link" onclick="switchAdminTab(document.querySelector('.admin-tabs .tab'),'at-overview')"><div class="stat-icon">🏗️</div><div class="stat-value">${db.chantiers.length}</div><div class="stat-label">Chantiers total</div></div>
        <div class="stat-card stat-card-link" onclick="switchAdminTab(document.querySelectorAll('.admin-tabs .tab')[3],'at-trace')"><div class="stat-icon">📸</div><div class="stat-value">${db.photos.length}</div><div class="stat-label">Photos total</div></div>
        <div class="stat-card stat-card-link" onclick="switchAdminTab(document.querySelectorAll('.admin-tabs .tab')[1],'at-users')"><div class="stat-icon">👥</div><div class="stat-value">${db.users.length}</div><div class="stat-label">Opérateurs</div></div>
        <div class="stat-card stat-card-link" onclick="switchAdminTab(document.querySelectorAll('.admin-tabs .tab')[7],'at-issues')"><div class="stat-icon">⚠️</div><div class="stat-value">${db.issues.filter(i=>i.status==='open').length}</div><div class="stat-label">Problèmes ouverts</div></div>
      </div>
      ${noPhotoToday.length ? `<div class="card" style="border-color:var(--yellow);background:var(--yellow-l)">
        <div class="card-title" style="color:var(--yellow)">⚠️ Pas de photo aujourd'hui</div>
        ${noPhotoToday.map(u => `<div style="font-size:13px;padding:4px 0;color:var(--text2)">${u.name} (${u.username})</div>`).join('')}
      </div>` : '<div class="card" style="border-color:var(--green)"><div style="color:var(--green);font-weight:700">✅ Tous les opérateurs ont été actifs aujourd\'hui</div></div>'}
    </div>

    <div id="at-users" style="display:none">
      ${can(5) ? `<button class="btn btn-primary btn-sm" style="margin-bottom:12px" onclick="showAddUser()">+ Ajouter un opérateur</button>` : ''}
      <div class="card" style="padding:0">
        ${db.users.map(u => {
          const uPhotos = db.photos.filter(p => p.takenBy === u.id).length;
          const role = ROLES[u.role] || {};
          return `<div class="user-row" style="padding:12px 16px">
            <div class="user-avatar" style="background:${u.avatarColor}">${avatarInitials(u.name)}</div>
            <div class="user-info">
              <div class="user-name">${u.name}</div>
              <div class="user-role">${role.icon} ${role.label}</div>
              <div class="user-stats">@${u.username} — ${uPhotos} photos — ${u.lastLogin ? 'vu ' + timeAgo(u.lastLogin) : 'jamais connecté'}</div>
            </div>
            ${can(5) && u.role !== 'superadmin' ? `<button style="background:var(--red-l);border:none;color:var(--red);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer" onclick="deleteUser('${u.id}')">✕</button>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>

    <div id="at-requests" style="display:none">
      ${db.pendingRequests.length === 0
        ? `<div class="empty"><div class="empty-icon">✅</div><div class="empty-title">Aucune demande en attente</div></div>`
        : db.pendingRequests.map(r => `
          <div class="card" style="margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
              <div class="user-avatar" style="background:var(--blue);width:44px;height:44px;font-size:16px">${avatarInitials(r.name)}</div>
              <div style="flex:1">
                <div style="font-size:15px;font-weight:700">${r.name}</div>
                <div style="font-size:12px;color:var(--text2)">${r.email}</div>
                <div style="display:flex;gap:6px;margin-top:4px">
                  <span class="badge badge-gray">${ROLES[r.role]?.icon || ''} ${ROLES[r.role]?.label || r.role}</span>
                  <span style="font-size:11px;color:var(--text3)">${timeAgo(r.requestedAt)}</span>
                </div>
              </div>
            </div>
            <div class="btn-row">
              <button class="btn btn-success btn-sm" onclick="approveRequest('${r.id}')">✓ Approuver</button>
              <button class="btn btn-danger btn-sm" onclick="rejectRequest('${r.id}')">✕ Refuser</button>
            </div>
          </div>`).join('')
      }
    </div>

    <div id="at-trace" style="display:none">
      <div style="margin-bottom:12px">
        <input class="search-input" style="padding-left:16px" placeholder="Filtrer par nom, chantier..." oninput="filterTrace(this.value)">
      </div>
      <div id="traceList">
        ${db.photos.slice().reverse().slice(0,50).map(p => {
          const c = db.chantiers.find(x => x.id === p.chantierId);
          const u = db.users.find(x => x.id === p.takenBy);
          return `<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
            <img src="${p.thumb||p.data}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0">
            <div style="flex:1;overflow:hidden">
              <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c?.name || '—'}</div>
              <div style="font-size:11px;color:var(--text2)">${u?.name || '?'} — ${p.surface}</div>
              <div style="font-size:11px;color:var(--text3)">${p.address || ''}</div>
            </div>
            <div style="font-size:10px;color:var(--text3);flex-shrink:0;text-align:right">${formatTime(p.takenAt)}<br>${new Date(p.takenAt).toLocaleDateString('fr-FR')}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div id="at-backup" style="display:none">
      <div class="card">
        <div class="card-title">☁️ Google Drive</div>
        <div style="font-size:13px;color:var(--text2);margin:8px 0">
          ${driveToken ? '✅ Connecté' : '❌ Non connecté'} ${db.settings.lastSync ? '— Sync : ' + timeAgo(db.settings.lastSync) : ''}
        </div>
        <div class="field" style="margin-bottom:10px">
          <label>Client ID Google</label>
          <input type="text" id="driveClientId" value="${db.settings.driveClientId || ''}" placeholder="xxx.apps.googleusercontent.com">
        </div>
        <div class="btn-row">
          <button class="btn btn-secondary btn-sm" onclick="saveDriveClientId()">Enregistrer</button>
          <button class="btn btn-primary btn-sm" onclick="driveConnect()">Se connecter</button>
        </div>
        ${driveToken ? `<button class="btn btn-success btn-sm" style="margin-top:8px" onclick="driveSync()">↺ Synchroniser maintenant</button>` : ''}
      </div>
      <div class="card" style="margin-top:12px">
        <div class="card-title">🔥 Firebase — Sync temps réel</div>
        <div style="font-size:13px;color:var(--text2);margin:6px 0 10px">
          Synchronise automatiquement les chantiers, utilisateurs et données entre tous vos appareils en temps réel.
          Les photos restent stockées localement sur chaque appareil.
        </div>
        <div style="font-size:14px;margin-bottom:8px">
          <span class="firebase-dot ${fbDb ? 'connected' : 'error'}"></span>
          <span class="firebase-status-txt">${fbDb ? '✅ Connecté — projet renotrace-74aab' : '❌ Non connecté (vérifiez la connexion internet)'}</span>
        </div>
        ${db.settings._fbLastRemote ? `<div style="font-size:12px;color:var(--text3)">Dernière sync reçue : ${timeAgo(new Date(db.settings._fbLastRemote).toISOString())}</div>` : ''}
        <button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="firebasePush().then(()=>toast('Données envoyées ✓','success'))">↑ Pousser mes données maintenant</button>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="card-title">💾 Export / Import</div>
        <div style="font-size:13px;color:var(--text2);margin-bottom:12px">
          ${db.chantiers.length} chantiers, ${db.photos.length} photos, ${db.users.length} utilisateurs
        </div>
        <div class="btn-row">
          <button class="btn btn-secondary btn-sm" onclick="exportJson()">↓ Exporter JSON</button>
          <button class="btn btn-secondary btn-sm" onclick="el('importInputAdmin').click()">↑ Importer JSON</button>
        </div>
        <input type="file" id="importInputAdmin" accept=".json" style="display:none" onchange="importJson(this.files[0])">
      </div>
    </div>

    <div id="at-audit" style="display:none">
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.8px">
        ${(db.auditLog || []).length} événements enregistrés
      </div>
      ${(db.auditLog || []).length === 0
        ? '<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">Aucun événement</div></div>'
        : (db.auditLog || []).slice(0, 100).map(e => {
            const icons = { login:'🔐', logout:'🚪', pwd_change:'🔑', pwd_reset:'⚠️', user_create:'👤', user_approved:'✅', photo:'📸', chantier:'🏗️' };
            return `<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);align-items:flex-start">
              <span style="font-size:18px;flex-shrink:0">${icons[e.action] || '📝'}</span>
              <div style="flex:1">
                <div style="font-size:13px;font-weight:700">${e.userName}</div>
                <div style="font-size:12px;color:var(--text2)">${e.detail}</div>
              </div>
              <div style="font-size:10px;color:var(--text3);flex-shrink:0;text-align:right">
                ${new Date(e.timestamp).toLocaleDateString('fr-FR')}<br>
                ${new Date(e.timestamp).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}
              </div>
            </div>`;
          }).join('')
      }
    </div>

    <div id="at-issues" style="display:none">
      ${(() => {
        const allIssues = (db.issues || []).slice().sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
        if (!allIssues.length) return '<div class="empty"><div class="empty-icon">✅</div><div class="empty-title">Aucun problème signalé</div></div>';
        const sevColors = {low:'badge-gray',medium:'badge-orange',high:'badge-red',critical:'badge-red'};
        const sevLabels = {low:'Faible',medium:'Moyen',high:'Élevé',critical:'Critique'};
        const stColors  = {open:'badge-red',in_progress:'badge-blue',resolved:'badge-green'};
        const stLabels  = {open:'Ouvert',in_progress:'En cours',resolved:'Résolu'};
        return allIssues.map(i => {
          const c = db.chantiers.find(x => x.id === i.chantierId);
          return `<div class="card" style="margin-bottom:10px">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
              <div style="flex:1">
                <div style="font-size:15px;font-weight:700">${i.title}</div>
                ${i.description ? `<div style="font-size:12px;color:var(--text2);margin-top:2px">${i.description}</div>` : ''}
              </div>
              <span class="badge ${stColors[i.status]||'badge-gray'}" style="flex-shrink:0">${stLabels[i.status]||i.status}</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
              <span class="badge ${sevColors[i.severity]||'badge-gray'}">${sevLabels[i.severity]||i.severity}</span>
              <span style="font-size:11px;color:var(--text2)">🏗️ ${c?.name||'?'}</span>
              <span style="font-size:11px;color:var(--text2)">👤 ${i.createdByName||getUserName(i.createdBy)}</span>
              <span style="font-size:11px;color:var(--text3)">${timeAgo(i.createdAt)}</span>
            </div>
            ${i.status !== 'resolved' ? `<button onclick="resolveIssueAdmin('${i.id}')" style="margin-top:10px;background:var(--green-l);color:var(--green);border:1.5px solid var(--green-m);border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;width:100%">✓ Marquer comme résolu</button>` : ''}
          </div>`;
        }).join('');
      })()}
    </div>

    <div id="at-tasks" style="display:none">
      ${(() => {
        const allTasks = (db.tasks || []);
        if (!allTasks.length) return '<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">Aucune tâche enregistrée</div></div>';
        // Grouper par utilisateur
        const byUser = {};
        allTasks.forEach(t => {
          const uid = t.createdBy || '_anon';
          if (!byUser[uid]) byUser[uid] = { name: t.createdByName || 'Inconnu', tasks: [] };
          byUser[uid].tasks.push(t);
        });
        return Object.entries(byUser).map(([uid, g]) => {
          const u = db.users.find(x => x.id === uid);
          const done = g.tasks.filter(t => t.done).length;
          return `<div class="card" style="margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
              <div class="user-avatar" style="background:${u?.avatarColor||'#2563EB'};width:34px;height:34px;font-size:12px">${avatarInitials(u?.name||g.name)}</div>
              <div style="flex:1">
                <div style="font-size:14px;font-weight:700">${u?.name||g.name}</div>
                <div style="font-size:11px;color:var(--text2)">${g.tasks.length} tâche(s) — ${done} terminée(s)</div>
              </div>
            </div>
            ${g.tasks.sort((a,b)=>(a.done?1:0)-(b.done?1:0)).map(t => `
              <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
                <span style="font-size:14px">${t.done?'✅':'⬜'}</span>
                <span style="flex:1;font-size:13px;${t.done?'text-decoration:line-through;color:var(--text3)':''}">${t.text}</span>
                <span style="font-size:10px;color:var(--text3)">${timeAgo(t.createdAt)}</span>
              </div>`).join('')}
          </div>`;
        }).join('');
      })()}
    </div>
  `;
}
function switchAdminTab(btn, id) {
  document.querySelectorAll('.admin-tabs .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  ['at-overview','at-users','at-requests','at-trace','at-backup','at-audit','at-tasks','at-issues'].forEach(s => {
    const d = document.getElementById(s);
    if (d) d.style.display = s === id ? '' : 'none';
  });
}
function resolveIssueAdmin(issueId) {
  const i = db.issues.find(x => x.id === issueId);
  if (!i) return;
  i.status = 'resolved';
  i.resolvedAt = now();
  i.resolvedBy = me()?.id;
  addAuditLog('issue', `Problème résolu : "${i.title}" par ${me()?.name}`);
  dbSave();
  toast('Problème marqué comme résolu ✓', 'success');
  renderAdmin();
}
function filterTrace(q) {
  const items = el('traceList')?.children;
  if (!items) return;
  Array.from(items).forEach(item => {
    item.style.display = !q || item.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}

// ═══════════════════════════════════════════
//   MODALS — FORMS
// ═══════════════════════════════════════════
function showAddChantier() {
  openModal(`
    <div class="modal-title">Nouveau chantier</div>
    <div class="field"><label>Nom du chantier</label><input id="f-name" type="text" placeholder="Ex: Rénovation Dupont"></div>
    <div class="field"><label>Client</label><input id="f-client" type="text" placeholder="Nom du client"></div>
    <div class="field"><label>Adresse</label><input id="f-address" type="text" placeholder="23 rue de la Paix, Paris"></div>
    <div class="field"><label>Type de travaux</label>
      <select id="f-type"><option>Isolation</option><option>Plomberie</option><option>Électricité</option><option>Menuiserie</option><option>Peinture</option><option>Toiture</option><option>Autre</option></select>
    </div>
    <div class="btn-row">
      <div class="field" style="flex:1"><label>Début</label><input id="f-start" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="field" style="flex:1"><label>Fin prévue</label><input id="f-end" type="date"></div>
    </div>
    <div class="field"><label>Notes</label><textarea id="f-notes" placeholder="Informations complémentaires..."></textarea></div>
    <button class="btn btn-primary" onclick="saveChantier()">Créer le chantier</button>
  `);
}
function saveChantier(editId = null) {
  const name = el('f-name')?.value.trim();
  const client = el('f-client')?.value.trim();
  const address = el('f-address')?.value.trim();
  if (!name || !client) { toast('Remplissez le nom et le client', 'warning'); return; }
  if (editId) {
    const c = db.chantiers.find(x => x.id === editId);
    if (c) { c.name = name; c.client = client; c.address = address || ''; c.type = el('f-type').value; c.startDate = el('f-start').value; c.endDate = el('f-end').value; c.notes = el('f-notes').value; c.updatedAt = now(); }
  } else {
    db.chantiers.push({ id: uid(), name, client, address: address || '', type: el('f-type').value, status: 'en_cours', progress: 0, startDate: el('f-start').value, endDate: el('f-end').value, notes: el('f-notes').value, createdBy: me().id, createdAt: now(), updatedAt: now() });
  }
  dbSave();
  closeModal();
  toast(editId ? 'Chantier modifié ✓' : 'Chantier créé ✓', 'success');
  renderChantiers();
}
function showEditChantier(id) {
  const c = db.chantiers.find(x => x.id === id);
  if (!c) return;
  openModal(`
    <div class="modal-title">Modifier le chantier</div>
    <div class="field"><label>Nom</label><input id="f-name" type="text" value="${c.name}"></div>
    <div class="field"><label>Client</label><input id="f-client" type="text" value="${c.client}"></div>
    <div class="field"><label>Adresse</label><input id="f-address" type="text" value="${c.address}"></div>
    <div class="field"><label>Type</label><select id="f-type"><option>Isolation</option><option>Plomberie</option><option>Électricité</option><option>Menuiserie</option><option>Peinture</option><option>Toiture</option><option>Autre</option></select></div>
    <div class="field"><label>Statut</label>
      <select id="f-status" onchange="updateProgress('${id}',this.value)">
        <option value="en_cours" ${c.status==='en_cours'?'selected':''}>En cours</option>
        <option value="en_attente" ${c.status==='en_attente'?'selected':''}>En attente</option>
        <option value="suspendu" ${c.status==='suspendu'?'selected':''}>Suspendu</option>
        <option value="termine" ${c.status==='termine'?'selected':''}>Terminé</option>
      </select>
    </div>
    <div class="field"><label>Avancement (${c.progress || 0}%)</label>
      <input id="f-progress" type="range" min="0" max="100" value="${c.progress||0}" oninput="document.querySelector('[for=f-progress]')&&(document.querySelector('[for=f-progress]').textContent='Avancement ('+this.value+'%)')">
    </div>
    <div class="btn-row">
      <div class="field" style="flex:1"><label>Début</label><input id="f-start" type="date" value="${c.startDate||''}"></div>
      <div class="field" style="flex:1"><label>Fin prévue</label><input id="f-end" type="date" value="${c.endDate||''}"></div>
    </div>
    <div class="field"><label>Notes</label><textarea id="f-notes">${c.notes||''}</textarea></div>
    <button class="btn btn-primary" onclick="saveChantierEdit('${id}')">Enregistrer</button>
  `);
  el('f-type').value = c.type;
}
function saveChantierEdit(id) {
  const c = db.chantiers.find(x => x.id === id);
  if (!c) return;
  c.name = el('f-name').value.trim() || c.name;
  c.client = el('f-client').value.trim() || c.client;
  c.address = el('f-address').value.trim();
  c.type = el('f-type').value;
  c.status = el('f-status').value;
  c.progress = parseInt(el('f-progress').value) || 0;
  c.startDate = el('f-start').value;
  c.endDate = el('f-end').value;
  c.notes = el('f-notes').value;
  c.updatedAt = now();
  dbSave(); closeModal();
  toast('Chantier modifié ✓', 'success');
  renderChantier(id);
}
function showChantierMenu(id) {
  openModal(`
    <div class="modal-title">Options du chantier</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${can(2) ? `<button class="btn btn-secondary" onclick="closeModal();showEditChantier('${id}')">✏️ Modifier</button>` : ''}
      <button class="btn btn-secondary" onclick="closeModal();exportChantierHtml('${id}')">📄 Exporter rapport</button>
      ${can(3) ? `<button class="btn btn-danger" onclick="closeModal();deleteChantier('${id}')">🗑 Supprimer le chantier</button>` : ''}
    </div>
  `);
}
function deleteChantier(id) {
  if (!confirm('Supprimer ce chantier et toutes ses photos ?')) return;
  db.chantiers = db.chantiers.filter(c => c.id !== id);
  db.photos = db.photos.filter(p => p.chantierId !== id);
  db.issues = db.issues.filter(i => i.chantierId !== id);
  dbSave(); closeModal();
  toast('Chantier supprimé', 'success');
  navigate('chantiers');
}
function showAddIssue(chantierId) {
  openModal(`
    <div class="modal-title">Signaler un problème</div>
    <div class="field"><label>Titre</label><input id="i-title" type="text" placeholder="Fissure mur, Humidité, Mauvais calfeutrage..."></div>
    <div class="field"><label>Description</label><textarea id="i-desc" placeholder="Détails..."></textarea></div>
    <div class="field"><label>Sévérité</label>
      <select id="i-sev"><option value="low">Faible</option><option value="medium">Moyen</option><option value="high" selected>Élevé</option><option value="critical">Critique</option></select>
    </div>
    <button class="btn btn-danger" onclick="saveIssue('${chantierId}')">Signaler</button>
  `);
}
function saveIssue(chantierId) {
  const title = el('i-title')?.value.trim();
  if (!title) { toast('Saisissez un titre', 'warning'); return; }
  const reporter = me();
  const chantier = db.chantiers.find(x => x.id === chantierId);
  const issue = {
    id: uid(), chantierId, title,
    description: el('i-desc')?.value || '',
    severity: el('i-sev')?.value || 'high',
    status: 'open',
    createdBy: reporter.id, createdByName: reporter.name,
    createdAt: now()
  };
  db.issues.push(issue);
  addAuditLog('issue', `Problème signalé : "${title}" sur ${chantier?.name || '?'} par ${reporter.name}`);
  dbSave(); closeModal();
  toast('Problème signalé ✓', 'success');
  // Email notification à l'admin
  const adminUser = db.users.find(u => u.role === 'superadmin' && u.email);
  if (adminUser?.email) {
    const sevLabel = {low:'Faible',medium:'Moyen',high:'Élevé',critical:'Critique'}[issue.severity] || issue.severity;
    const subject = encodeURIComponent(`⚠️ RénoTrace — Problème signalé : ${title}`);
    const body = encodeURIComponent(
      `Nouveau problème signalé sur RénoTrace Pro\n\n` +
      `Chantier : ${chantier?.name || '?'}\n` +
      `Signalé par : ${reporter.name}\n` +
      `Sévérité : ${sevLabel}\n` +
      `Titre : ${title}\n` +
      `Description : ${issue.description || '—'}\n` +
      `Date : ${new Date().toLocaleString('fr-FR')}\n\n` +
      `Connectez-vous au panel Admin → onglet Problèmes pour gérer cette alerte.`
    );
    window.open(`mailto:${adminUser.email}?subject=${subject}&body=${body}`, '_blank');
  }
  renderChantier(chantierId);
}
function showAddUser() {
  openModal(`
    <div class="modal-title">Ajouter un opérateur</div>
    <div class="field"><label>Nom complet</label><input id="u-name" type="text" placeholder="Jean Dupont"></div>
    <div class="field"><label>Email professionnel</label><input id="u-email" type="email" placeholder="jean@entreprise.com" autocapitalize="none"></div>
    <div class="field"><label>Identifiant (login)</label><input id="u-user" type="text" placeholder="jean.dupont" autocapitalize="none"></div>
    <div class="field"><label>Mot de passe</label><input id="u-pass" type="password" placeholder="Minimum 8 caractères" oninput="updatePwdStrength(this.value)">${pwdStrengthHtml()}</div>
    <div class="field"><label>Rôle</label>
      <select id="u-role">
        <option value="technicien">Technicien</option>
        <option value="chef">Chef de chantier</option>
        <option value="conducteur">Conducteur de travaux</option>
        <option value="dirigeant">Dirigeant</option>
      </select>
    </div>
    <button class="btn btn-primary" onclick="saveUser()">Créer le compte</button>
  `);
}
async function saveUser() {
  const name     = el('u-name')?.value.trim();
  const email    = el('u-email')?.value.trim().toLowerCase();
  const username = el('u-user')?.value.trim().toLowerCase();
  const password = el('u-pass')?.value;
  const role     = el('u-role')?.value;
  if (!name || !username || !password || password.length < 8) { toast('Remplissez tous les champs (mdp min 8 car.)', 'warning'); return; }
  if (db.users.find(u => u.username === username)) { toast('Cet identifiant existe déjà', 'error'); return; }
  if (email && db.users.find(u => u.email && u.email === email)) { toast('Cet email est déjà utilisé', 'error'); return; }
  const { hash: ph, salt: ps } = await hashPwdSafe(password);
  db.users.push({ id: uid(), name, email: email || null, username, passwordHash: ph, passwordSalt: ps, mustChangePwd: false, role, createdAt: now(), lastLogin: null, avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] });
  addAuditLog('user_create', `Création compte ${username} (${role})`);
  dbSave(); closeModal();
  toast('Compte créé ✓', 'success');
  renderAdmin();
}
function deleteUser(id) {
  const u = db.users.find(x => x.id === id);
  if (!u || !confirm(`Supprimer ${u.name} ?`)) return;
  db.users = db.users.filter(x => x.id !== id);
  dbSave();
  toast('Compte supprimé', 'success');
  renderAdmin();
}

async function approveRequest(id) {
  const req = db.pendingRequests.find(r => r.id === id);
  if (!req) return;
  // Génère un mot de passe temporaire
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const tmp = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const { hash: ph, salt: ps } = await hashPwdSafe(tmp);
  // Crée le compte
  const username = req.email.split('@')[0].replace(/[^a-z0-9.]/gi, '.').toLowerCase();
  const safeUser = db.users.find(u => u.username === username) ? username + '.' + uid().slice(0,4) : username;
  db.users.push({
    id: uid(), name: req.name, email: req.email, username: safeUser,
    passwordHash: ph, passwordSalt: ps, mustChangePwd: true, role: req.role,
    createdAt: now(), lastLogin: null,
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]
  });
  addAuditLog('user_approved', `Demande approuvée : ${req.name} (${req.email})`);
  db.pendingRequests = db.pendingRequests.filter(r => r.id !== id);
  dbSave();
  // Affiche le mot de passe temporaire à l'admin
  openModal(`
    <div class="modal-title">✅ Compte créé</div>
    <p style="font-size:13px;color:var(--text2);margin-bottom:16px">
      Le compte de <b>${req.name}</b> a été créé. Communiquez-lui ces informations (SMS, WhatsApp, email) :
    </p>
    <div style="background:var(--bg);border-radius:12px;padding:16px;margin-bottom:16px">
      <div style="font-size:12px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px">Identifiant</div>
      <div style="font-size:18px;font-weight:800">${safeUser}</div>
      <div style="font-size:12px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin:12px 0 6px">Mot de passe temporaire</div>
      <div style="font-size:28px;font-weight:800;letter-spacing:4px;color:var(--blue)">${tmp}</div>
    </div>
    <p style="font-size:12px;color:var(--text3)">La personne devra changer son mot de passe dans Profil → Modifier mon profil.</p>
    <button class="btn btn-primary" onclick="closeModal()">J'ai noté, fermer</button>
  `);
  toast(`Compte créé pour ${req.name}`, 'success');
  renderAdmin();
}

function rejectRequest(id) {
  const req = db.pendingRequests.find(r => r.id === id);
  if (!req || !confirm(`Refuser la demande de ${req.name} ?`)) return;
  db.pendingRequests = db.pendingRequests.filter(r => r.id !== id);
  dbSave();
  toast('Demande refusée', 'success');
  renderAdmin();
}
function showEditProfile() {
  const user = me();
  openModal(`
    <div class="modal-title">Mon profil</div>
    <div class="field"><label>Nom complet</label><input id="p-name" type="text" value="${user.name}"></div>
    <div class="field"><label>Email</label><input id="p-email" type="email" placeholder="votre@email.com" value="${user.email || ''}"></div>
    <div class="field"><label>Identifiant</label><input id="p-user" type="text" value="${user.username}" autocapitalize="none"></div>
    <div class="field"><label>Nouveau mot de passe</label><input id="p-pass" type="password" placeholder="Laisser vide pour ne pas changer (min 8 car.)" oninput="updatePwdStrength(this.value)">${pwdStrengthHtml()}</div>
    <button class="btn btn-primary" onclick="saveProfile()">Enregistrer</button>
  `);
}
async function saveProfile() {
  const user = me();
  const name  = el('p-name')?.value.trim();
  const email = el('p-email')?.value.trim().toLowerCase();
  const uname = el('p-user')?.value.trim().toLowerCase();
  const pass  = el('p-pass')?.value;

  if (name) user.name = name;
  if (email) {
    // Vérifier que l'email n'est pas pris par quelqu'un d'autre
    const conflict = db.users.find(u => u.id !== user.id && u.email && u.email.toLowerCase() === email);
    if (conflict) { toast('Cet email est déjà utilisé par un autre compte', 'error'); return; }
    user.email = email;
  }
  if (uname && uname !== user.username) {
    if (db.users.find(u => u.id !== user.id && u.username === uname)) { toast('Cet identifiant est déjà pris', 'error'); return; }
    user.username = uname;
  }
  if (pass) {
    if (pass.length < 8) { toast('Mot de passe min 8 caractères', 'warning'); return; }
    const { hash, salt } = await hashPwdSafe(pass);
    user.passwordHash = hash; user.passwordSalt = salt; user.mustChangePwd = false;
    addAuditLog('pwd_change', 'Changement de mot de passe');
  }

  dbSave(); closeModal();
  toast('Profil modifié ✓', 'success');
  renderProfile();
}
function showGroqSettings() {
  openModal(`
    <div class="modal-title">🤖 Clé API Groq</div>
    <p style="font-size:13px;color:var(--text2);margin-bottom:14px">Créez une clé sur <b>console.groq.com</b> → API Keys → Create API Key</p>
    <div class="field"><label>Clé Groq</label><input id="g-key" type="text" placeholder="gsk_..." value="${db.settings?.groqKey || ''}"></div>
    <button class="btn btn-primary" onclick="saveGroqKey()">Enregistrer</button>
  `);
}
function saveGroqKey() {
  db.settings.groqKey = el('g-key')?.value.trim();
  dbSave(); closeModal();
  toast('Clé IA enregistrée ✓', 'success');
}
function showDriveSettings() {
  openModal(`
    <div class="modal-title">☁️ Google Drive</div>
    <div style="background:var(--blue-l);border:1.5px solid var(--blue-m);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;color:var(--blue)">
      <b>Format correct du Client ID :</b><br>
      <code style="font-size:11px;word-break:break-all">179182751689-xxx.apps.googleusercontent.com</code><br><br>
      ⚠️ Ne collez <b>pas</b> une URL (https://...) — uniquement l'identifiant OAuth.<br>
      <a onclick="openModal('<div class=modal-title>Obtenir le Client ID</div><ol style=font-size:13px;line-height:2><li>Allez sur <b>console.cloud.google.com</b></li><li>Créez un projet</li><li>APIs → Activer <b>Google Drive API</b></li><li>Identifiants → OAuth 2.0 → Application Web</li><li>URI de redirection : URL de votre app</li><li>Copiez le <b>Client ID</b></li></ol><button class=btn onclick=closeModal()>Fermer</button>')" style="cursor:pointer;font-weight:700;text-decoration:underline">Comment l'obtenir ?</a>
    </div>
    <div class="field"><label>Client ID Google OAuth 2.0</label>
      <input id="d-id" type="text" placeholder="179182751689-xxx.apps.googleusercontent.com" value="${db.settings?.driveClientId || ''}" oninput="validateClientIdInput(this)">
      <div id="d-id-error" style="font-size:11px;color:var(--red);margin-top:4px;display:none"></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="saveDriveClientId()">Enregistrer</button>
      <button class="btn btn-primary" onclick="driveConnect()">Se connecter</button>
    </div>
    ${driveToken ? '<div style="color:var(--green);font-weight:700;margin-top:10px">✅ Connecté</div>' : ''}
  `);
}
function validateClientIdInput(input) {
  const errEl = el('d-id-error');
  if (!errEl) return;
  const v = input.value.trim();
  if (!v) { errEl.style.display = 'none'; return; }
  if (v.startsWith('http')) {
    errEl.textContent = '⚠ Ne collez pas une URL — copiez uniquement le Client ID depuis Google Console';
    errEl.style.display = 'block';
  } else if (v.length > 10 && !v.includes('.apps.googleusercontent.com')) {
    errEl.textContent = 'Le Client ID doit se terminer par .apps.googleusercontent.com';
    errEl.style.display = 'block';
  } else {
    errEl.style.display = 'none';
  }
}
function saveDriveClientId() {
  const raw = (el('d-id')?.value || el('driveClientId')?.value || '').trim();
  if (!raw) return;
  if (raw.startsWith('http')) {
    toast('Ne collez pas une URL — copiez le Client ID depuis Google Console', 'error'); return;
  }
  if (!raw.includes('.apps.googleusercontent.com')) {
    toast('Format invalide — le Client ID doit se terminer par .apps.googleusercontent.com', 'error'); return;
  }
  db.settings.driveClientId = raw;
  dbSave();
  toast('Client ID enregistré ✓', 'success');
}
function showCompanySettings() {
  openModal(`
    <div class="modal-title">🏢 Paramètres entreprise</div>
    <div class="field"><label>Nom de l'entreprise</label><input id="co-name" type="text" value="${db.settings.companyName}"></div>
    <button class="btn btn-primary" onclick="saveCompany()">Enregistrer</button>
  `);
}
function saveCompany() {
  db.settings.companyName = el('co-name')?.value.trim() || db.settings.companyName;
  dbSave(); closeModal(); toast('Enregistré ✓', 'success');
}

// ═══════════════════════════════════════════
//   TÉLÉCHARGEMENT GUIDE
// ═══════════════════════════════════════════
function downloadGuide(role) {
  const guideFiles = {
    superadmin: 'GUIDE-ADMIN.md',
    dirigeant:  'GUIDE-DIRIGEANT.md',
    conducteur: 'GUIDE-CONDUCTEUR.md',
    chef:       'GUIDE-CHEF-CHANTIER.md',
    technicien: 'GUIDE-TECHNICIEN.md',
  };
  const filename = guideFiles[role] || 'GUIDE-TECHNICIEN.md';
  const txtName  = filename.replace('.md', '.txt');
  fetch('./' + filename)
    .then(r => r.text())
    .then(text => {
      const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = txtName;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    })
    .catch(() => toast('Erreur téléchargement guide', 'error'));
  toast('Guide téléchargé ✓', 'success');
}

// ═══════════════════════════════════════════
//   ACTIVITÉ RÉCENTE — VOIR PHOTO
// ═══════════════════════════════════════════
function viewActivityPhoto(photoId, chantierId) {
  navigate('chantier', chantierId);
  setTimeout(() => openLightbox(photoId), 120);
}

// ═══════════════════════════════════════════
//   NAVIGATION RACCOURCIS DASHBOARD
// ═══════════════════════════════════════════
function navigateDashStat(type) {
  const today = new Date().toISOString().slice(0,10);
  if (type === 'chantiers') {
    navigate('chantiers');
  } else if (type === 'photos') {
    const todayPhotos = db.photos.filter(p => p.takenAt?.startsWith(today));
    if (!todayPhotos.length) { navigate('chantiers'); return; }
    // Compte les photos par chantier, navigue vers le plus actif
    const counts = {};
    todayPhotos.forEach(p => counts[p.chantierId] = (counts[p.chantierId] || 0) + 1);
    const topId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    navigate('chantier', topId);
  } else if (type === 'users') {
    if (can(3)) navigate('admin');
    else navigate('chantiers');
  } else if (type === 'week') {
    navigate('chantiers');
  }
}

// ═══════════════════════════════════════════
//   TÂCHES / BLOC-NOTES
// ═══════════════════════════════════════════
function renderTaskList() {
  const list = el('taskList');
  if (!list) return;
  const myId = me()?.id;
  // Chaque utilisateur voit ses propres tâches (rétrocompat : tâches sans createdBy visibles par tous)
  const myTasks = (db.tasks || []).filter(t => !t.createdBy || t.createdBy === myId);
  const tasks = [...myTasks].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
  list.innerHTML = tasks.length
    ? tasks.map(t => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleTask('${t.id}')"
          style="width:18px;height:18px;cursor:pointer;accent-color:var(--blue);flex-shrink:0">
        <span style="flex:1;font-size:14px;${t.done ? 'text-decoration:line-through;color:var(--text3)' : ''}">${t.text}</span>
        <button onclick="deleteTask('${t.id}')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px;padding:0 4px;line-height:1">✕</button>
      </div>`).join('')
    : '<div style="font-size:13px;color:var(--text3);padding:8px 0;text-align:center">Aucune tâche — ajoutez-en une ci-dessous</div>';
}
function addTask() {
  const input = el('taskInput');
  const text = input?.value.trim();
  if (!text) return;
  if (!db.tasks) db.tasks = [];
  const user = me();
  db.tasks.unshift({ id: uid(), text, done: false, createdAt: now(), createdBy: user?.id || null, createdByName: user?.name || 'Inconnu' });
  dbSave();
  input.value = '';
  renderTaskList();
}
function toggleTask(id) {
  const t = (db.tasks || []).find(x => x.id === id);
  if (t) { t.done = !t.done; dbSave(); renderTaskList(); }
}
function deleteTask(id) {
  if (!db.tasks) return;
  db.tasks = db.tasks.filter(t => t.id !== id);
  dbSave();
  renderTaskList();
}

// ═══════════════════════════════════════════
//   PWA + INSTALL
// ═══════════════════════════════════════════
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); installPrompt = e;
  el('installBanner').style.display = 'flex';
});
function doInstall() {
  if (installPrompt) { installPrompt.prompt(); installPrompt.userChoice.then(() => { el('installBanner').style.display = 'none'; installPrompt = null; }); }
}

// ═══════════════════════════════════════════
//   SURFACE PILLS
// ═══════════════════════════════════════════
document.addEventListener('click', e => {
  if (e.target.classList.contains('pill')) {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    e.target.classList.add('active');
  }
});

// ═══════════════════════════════════════════
//   KEYBOARD
// ═══════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    if (document.getElementById('loginScreen').classList.contains('active')) doLogin();
    else if (document.getElementById('aiScreen').classList.contains('active')) sendAI();
  }
  if (e.key === 'Escape') closeModal();
});

// ═══════════════════════════════════════════
//   PHOTO INPUT
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
//   INIT (async — attend le déchiffrement DB)
// ═══════════════════════════════════════════
async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  await loadGroqKeys(); // clés Groq depuis Apps Script
  // Déchiffrement de la base de données
  await dbLoad();
  firebaseInit();   // sync temps réel Firebase (no-op si non configuré)
  checkDriveToken();
  // Session dans sessionStorage (pas localStorage — efface à la fermeture du navigateur)
  try { session = JSON.parse(sessionStorage.getItem(SES_KEY)); } catch { session = null; }
  if (session && db.users.find(u => u.id === session.userId)) {
    startSessionTimer();
    navigate('dash');
  } else {
    navigate('login');
  }
}

// Reset timer sur toute interaction utilisateur
document.addEventListener('click',   resetSessionTimer, { passive: true });
document.addEventListener('keydown', resetSessionTimer, { passive: true });
document.addEventListener('DOMContentLoaded', () => {
  el('photoInput').addEventListener('change', e => handlePhotoImport(e.target.files));
  init();
});
