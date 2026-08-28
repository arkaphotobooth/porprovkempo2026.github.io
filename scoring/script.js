/**
 * MASS - Martial Arts Scoring System (HYBRID & LOCAL MODE)
 */

// 1. DEKLARASI STATE GLOBAL (Tetap dipertahankan karena UI bergantung pada ini)
let STATE = { categories: [], participants: [], matches: [], barcodes: [], settings: { numJudges: 5, minPesertaJuara: 1, enableVerifikator: false } };
const UI = { tabs: ['jadwal', 'kategori', 'atlet', 'timbang', 'drawing', 'scoring', 'ranking', 'juara', 'admin'], timerInterval: null, timerSeconds: 0 };

let ACTIVE_PLAYLIST = { isActive: false, block: null, dIdx: -1, cIdx: -1, bIdx: -1 };
let RANDORI_STATE = { merah: { score: 0, warnings: 0 }, putih: { score: 0, warnings: 0 } };
let RANDORI_HISTORY = [];
let SWAP_SELECTION = null;
let EMBU_SWAP_SELECTION = null;
let TEMP_RINCIAN_WASIT = {};
let isWasitDigitalMode = false;

let DEVICE_ROLE = localStorage.getItem('mass_device_role') || 'admin';
let IS_TV_LIVE = false;
let TV_PREVIEW_TIMEOUT = null;
let currentAthletePage = 1;
const ATHLETES_PER_PAGE = 50;
let isDataLoaded = false;

// 2. VARIABEL SISTEM HYBRID & LOKAL (BARU)
let SYSTEM_MODE = 'local'; // Default asumsi jalan di LAN
let database = null; // Variabel ini sekarang dinamis, bukan statis lagi
let firestoreDB = null;

// =========================================================
// PABRIK FORMAT NAMA & HELPER
// =========================================================
function formatNama(namaMentah, mode = 'html') {
    if (!namaMentah) return "-";
    let names = String(namaMentah).split(/[,+&]/).map(n => n.trim()).filter(n => n);
    if (names.length <= 1) return namaMentah;
    if (mode === 'html') return names.join('<br>');
    if (mode === 'excel') return names.join('\n');
    if (mode === 'inline') return names.join(' & ');
    return namaMentah;
}

function minsToTime(mins) {
    if (!mins) return "00:00";
    let h = Math.floor(mins / 60).toString().padStart(2, '0');
    let m = (mins % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
}

function normStr(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// =========================================================
// 🌐 ADAPTIVE ZERO-CONFIG SESSION LOADER (CLOUD & LOCAL)
// =========================================================
function loadSessionData() {
    try {
        const rawSession = localStorage.getItem('mass_kempo_session');
        if (!rawSession) return null;
        
        const session = JSON.parse(rawSession);
        
        // 1. Tentukan Peran Lapangan (Court) dari Sesi
        if (session.courtId || session.username) {
            const courtName = (session.courtId || session.username).toLowerCase().replace(/\s+/g, '_');
            DEVICE_ROLE = courtName;
            localStorage.setItem('mass_device_role', courtName);
            sessionStorage.setItem('role', session.role || 'panitera');
            sessionStorage.setItem('courtId', courtName);
        }

        // 2. Pre-Populate Kategori Pertandingan jika Memori Masih Kosong
        if (session.categories && Array.isArray(session.categories) && session.categories.length > 0) {
            if (!STATE.categories || STATE.categories.length === 0) {
                STATE.categories = session.categories.map((c, i) => ({
                    id: c.id || (Date.now() + i),
                    name: c.name,
                    type: c.type === 'embu' ? (c.format && c.format.toLowerCase().includes('pasangan') ? 2 : (c.format && c.format.toLowerCase().includes('regu') ? 3 : 1)) : 1,
                    discipline: c.type || (c.format && c.format.toLowerCase().includes('randori') ? 'randori' : 'embu')
                }));
            }
        }

        return session;
    } catch (e) {
        console.warn("Gagal membaca mass_kempo_session:", e);
        return null;
    }
}

// Jalankan pembacaan sesi seawal mungkin
const ACTIVE_SESSION = loadSessionData();

// =========================================================
// 3. FUNGSI SAKLAR OTOMATIS: INISIALISASI SISTEM (ADAPTIVE)
// =========================================================
async function initSystem() {
    const statusDot = document.getElementById('koneksi-dot');
    const statusText = document.getElementById('koneksi-text');

    if (statusText) statusText.innerText = 'MENGECEK JARINGAN...';

    // 1. DETEKSI MODE CLOUD STATIS (GitHub Pages / Netlify / mass_kempo_session)
    const isStaticCloudHost = window.location.hostname.includes('github.io') || 
                              window.location.hostname.includes('netlify.app') || 
                              (ACTIVE_SESSION && ACTIVE_SESSION.serverConfig && ACTIVE_SESSION.serverConfig.rtdbConfig);

    if (isStaticCloudHost && ACTIVE_SESSION && ACTIVE_SESSION.serverConfig && ACTIVE_SESSION.serverConfig.rtdbConfig) {
        SYSTEM_MODE = 'online';
        const rtdbConfig = ACTIVE_SESSION.serverConfig.rtdbConfig;
        const firestoreConfig = ACTIVE_SESSION.serverConfig.firestoreConfig || ACTIVE_SESSION.serverConfig.firestore_config;

        try {
            // A. RUMAH UTAMA: Inisialisasi Firebase RTDB dari Sesi
            if (!firebase.apps.length) {
                firebase.initializeApp(rtdbConfig);
            }
            database = firebase.database();

            // B. RUMAH KEDUA: Inisialisasi Firestore untuk Penarikan Waza & Pendaftaran
            try {
                if (firestoreConfig && Object.keys(firestoreConfig).length > 0) {
                    let appPendaftaran = firebase.apps.find(app => app.name === 'AplikasiPendaftaran');
                    if (!appPendaftaran) {
                        appPendaftaran = firebase.initializeApp(firestoreConfig, 'AplikasiPendaftaran');
                    }
                    firestoreDB = appPendaftaran.firestore();
                } else if (firebase.apps.length > 0) {
                    // Fallback jika menggunakan project Firebase yang sama
                    firestoreDB = firebase.firestore();
                }
            } catch (fsErr) {
                console.warn("Inisialisasi Firestore sekunder tertunda:", fsErr);
            }

            // Pantau Status Koneksi Realtime
            database.ref('.info/connected').on('value', (snap) => {
                if (snap.val() === true) {
                    if (statusDot) statusDot.className = 'w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(168,85,247,0.8)] transition-colors duration-300';
                    if (statusText) statusText.innerText = `ONLINE (CLOUD - ${DEVICE_ROLE.toUpperCase()})`;
                } else {
                    if (statusDot) statusDot.className = 'w-2.5 h-2.5 bg-yellow-500 rounded-full animate-pulse';
                    if (statusText) statusText.innerText = 'MENGHUBUNGKAN...';
                }
            });

            // Sinkronisasi Data Turnamen Global dari RTDB
            database.ref('turnamen_data').on('value', (snapshot) => {
                isDataLoaded = true;
                if (snapshot.exists()) {
                    const data = snapshot.val();
                    if (data) {
                        if (data.categories && data.categories.length > 0) STATE.categories = data.categories;
                        STATE.participants = data.participants || [];
                        STATE.matches = data.matches || [];
                        STATE.barcodes = data.barcodes || [];
                        STATE.rundown = (data.rundown_state && data.rundown_state.schedule) ? data.rundown_state.schedule : [];
                        if (data.settings) STATE.settings = data.settings;
                    }
                } else {
                    saveToLocalStorage();
                }
                refreshActiveUI();
            });

            return; // Selesai inisialisasi mode Cloud
        } catch (cloudErr) {
            console.error("Gagal inisialisasi Firebase dari session:", cloudErr);
        }
    }

    // 2. JALUR LOKAL LAN / HYBRID (NODE.JS SERVER)
    try {
        const response = await fetch('/api/network');
        if (!response.ok) throw new Error("Bukan server Node.js lokal");
        const networkData = await response.json();

        SYSTEM_MODE = networkData.mode || 'lokal';
        const isLocalMode = SYSTEM_MODE.toLowerCase() === 'local' || SYSTEM_MODE.toLowerCase() === 'lokal';

        if (!isLocalMode && networkData.rtdb_config && Object.keys(networkData.rtdb_config).length > 0) {
            if (!firebase.apps.length) firebase.initializeApp(networkData.rtdb_config);
            database = firebase.database();

            if (networkData.firestore_config && Object.keys(networkData.firestore_config).length > 0) {
                try {
                    let appPendaftaran = firebase.apps.find(app => app.name === 'AplikasiPendaftaran');
                    if (!appPendaftaran) {
                        appPendaftaran = firebase.initializeApp(networkData.firestore_config, 'AplikasiPendaftaran');
                    }
                    firestoreDB = appPendaftaran.firestore();
                } catch (e) {
                    console.warn("Firestore sekunder gagal dimuat:", e);
                }
            }

            database.ref('.info/connected').on('value', (snap) => {
                if (snap.val() === true) {
                    if (statusDot) statusDot.className = 'w-2.5 h-2.5 bg-purple-500 rounded-full shadow-[0_0_8px_rgba(168,85,247,0.8)] transition-colors duration-300';
                    if (statusText) statusText.innerText = `ONLINE (${SYSTEM_MODE.toUpperCase()})`;
                } else {
                    if (statusDot) statusDot.className = 'w-2.5 h-2.5 bg-yellow-500 rounded-full animate-pulse';
                    if (statusText) statusText.innerText = 'MENCARI FIREBASE...';
                }
            });

            database.ref('turnamen_data').on('value', (snapshot) => {
                isDataLoaded = true;
                if (!snapshot.exists()) return;
                const data = snapshot.val();
                if (data) {
                    STATE.categories = data.categories || [];
                    STATE.participants = data.participants || [];
                    STATE.matches = data.matches || [];
                    STATE.barcodes = data.barcodes || [];
                    STATE.rundown = (data.rundown_state && data.rundown_state.schedule) ? data.rundown_state.schedule : [];
                    if (data.settings) STATE.settings = data.settings;
                }
                refreshActiveUI();
            });

        } else {
            // Mode Lokal LAN Murni
            if (statusDot) statusDot.className = 'w-2.5 h-2.5 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.8)] transition-colors duration-300';
            if (statusText) statusText.innerText = 'LOKAL MURNI (LAN)';

            const dataRes = await fetch('/api/data_turnamen');
            if (dataRes.ok) {
                const localData = await dataRes.json();
                isDataLoaded = true;
                STATE.categories = localData.categories || [];
                STATE.participants = localData.participants || [];
                STATE.matches = localData.matches || [];
                STATE.barcodes = localData.barcodes || [];
                STATE.rundown = (localData.rundown_state && localData.rundown_state.schedule) ? localData.rundown_state.schedule : (localData.rundown || []);
                if (localData.settings) STATE.settings = localData.settings;
                refreshActiveUI();
            }
        }
    } catch (error) {
        console.warn("Server lokal Node.js tidak aktif / berjalan di hosting statis.");
        if (statusDot) statusDot.className = 'w-2.5 h-2.5 bg-yellow-500 rounded-full';
        if (statusText) statusText.innerText = 'OFFLINE / CACHE LOKAL';
        refreshActiveUI();
    }
}

// Fungsi pembantu agar layar tidak berkedip saat data ditarik
function refreshActiveUI() {
    updateAllDropdowns();
    const activeSection = UI.tabs.find(tab => {
        const el = document.getElementById(`section-${tab}`);
        return el && !el.classList.contains('hidden');
    });

    if (activeSection === 'kategori') renderCategoryList();
    if (activeSection === 'atlet') renderParticipantTable();
    if (activeSection === 'drawing') checkExistingDrawing();
    if (activeSection === 'jadwal') renderJadwalList();
    if (activeSection === 'scoring') filterPesertaScoring();
    if (activeSection === 'ranking') renderRanking();
    if (activeSection === 'juara') renderJuaraUmum();
}

document.addEventListener('DOMContentLoaded', () => {
    initSystem(); // Memanggil saklar pintar saat layar dimuat
    let savedJ = parseInt(localStorage.getItem('local_judges')) || 5;
    setJudges(savedJ);
    injectAdminExportButtons();
});

// =========================================================
// 5. PENYIMPANAN ADAPTIF (FIREBASE CLOUD & LOCAL DB)
// =========================================================
function saveToLocalStorage() {
    const isLocalMode = SYSTEM_MODE.toLowerCase() === 'local' || SYSTEM_MODE.toLowerCase() === 'lokal';
    const isHybridMode = SYSTEM_MODE.toLowerCase() === 'hybrid';
    const isCloudMode = SYSTEM_MODE.toLowerCase() === 'online' || SYSTEM_MODE.toLowerCase() === 'firebase';

    // 1. LOKAL & HYBRID: Kirim ke server Node.js SQLite (hanya jika bukan cloud statis)
    if ((isLocalMode || isHybridMode) && !window.location.hostname.includes('github.io') && !window.location.hostname.includes('netlify.app')) {
        fetch('/api/data_turnamen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                categories: STATE.categories, 
                participants: STATE.participants,
                matches: STATE.matches, 
                barcodes: STATE.barcodes,
                settings: STATE.settings, 
                rundown: STATE.rundown
            })
        }).then(res => {
            if (res.ok && typeof localSocket !== 'undefined' && localSocket) {
                localSocket.emit('broadcast_to_tv', { channel: 'global_state_update' });
            }
        }).catch(err => console.warn("Penyimpanan lokal LAN dilewati:", err));
    }

    // 2. HYBRID & CLOUD: Simpan langsung ke node utama Firebase RTDB
    if ((!isLocalMode || isCloudMode) && database) {
        database.ref('turnamen_data').update({
            categories: STATE.categories, 
            participants: STATE.participants,
            matches: STATE.matches, 
            barcodes: STATE.barcodes,
            settings: STATE.settings, 
            rundown_state: { schedule: STATE.rundown }
        }).catch(error => console.error("GAGAL SIMPAN FIREBASE:", error));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    refreshAllData();
    let savedJ = parseInt(localStorage.getItem('local_judges')) || 5; // Baca setingan laptop ini
    setJudges(savedJ);
    injectAdminExportButtons();
});

function injectAdminExportButtons() {
    const adminExportSection = document.querySelector('#section-admin .bg-dark-card.text-center');
    if (adminExportSection) {
        let currentMode = (STATE.settings && STATE.settings.tournamentMode) ? STATE.settings.tournamentMode : 'double';
        let currentFinalMode = (STATE.settings && STATE.settings.finalRandoriMode) ? STATE.settings.finalRandoriMode : 'single';
        let currentEmbuMode = (STATE.settings && STATE.settings.embuB2Mode) ? STATE.settings.embuB2Mode : 'reverse';

        // Membaca setting maksimal pool dari database
        let currentMaxPool = (STATE.settings && STATE.settings.maxPesertaPoolEmbu) ? STATE.settings.maxPesertaPoolEmbu : 12;

        adminExportSection.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div class="bg-slate-800 p-5 rounded-xl border border-slate-700 text-left shadow-lg">
                    <h3 class="text-md font-black text-red-400 mb-2"><i class="fas fa-cogs mr-2"></i>SISTEM RANDORI (UTAMA)</h3>
                    <p class="text-[10px] text-slate-400 mb-3">Aturan bagan untuk penyisihan Pool.</p>
                    <select id="setting-tournament-mode" onchange="saveTournamentMode()" class="w-full text-sm bg-slate-900 border border-slate-600 rounded p-2 text-white font-bold cursor-pointer hover:border-red-500 transition-colors mb-4">
                        <option value="double" ${currentMode === 'double' ? 'selected' : ''}>Double Elimination (Perkemi)</option>
                        <option value="single" ${currentMode === 'single' ? 'selected' : ''}>Single Elimination (Gugur Biasa)</option>
                    </select>
                    
                    <h3 class="text-md font-black text-orange-400 mb-2 border-t border-slate-700 pt-3"><i class="fas fa-project-diagram mr-2"></i>SISTEM FINAL RANDORI</h3>
                    <p class="text-[10px] text-slate-400 mb-3">Aturan khusus bagan "FINAL" (Crossover).</p>
                    <select id="setting-final-mode" onchange="saveFinalMode()" class="w-full text-sm bg-slate-900 border border-slate-600 rounded p-2 text-white font-bold cursor-pointer hover:border-orange-500 transition-colors">
                        <option value="single" ${currentFinalMode === 'single' ? 'selected' : ''}>Gugur Biasa (Crossover Standar)</option>
                        <option value="double" ${currentFinalMode === 'double' ? 'selected' : ''}>Double Elimination (Perkemi Crossover)</option>
                    </select>
                </div>
                
                <div class="bg-slate-800 p-5 rounded-xl border border-slate-700 text-left shadow-lg flex flex-col">
                    <h3 class="text-md font-black text-blue-400 mb-2"><i class="fas fa-sync-alt mr-2"></i>URUTAN EMBU B2</h3>
                    <p class="text-[10px] text-slate-400 mb-3">Sistem urut Babak 2 (Khusus Single Pool).</p>
                    <select id="setting-embu-mode" onchange="saveEmbuB2Mode()" class="w-full text-sm bg-slate-900 border border-slate-600 rounded p-2 text-white font-bold cursor-pointer hover:border-blue-500 transition-colors mb-4">
                        <option value="reverse" ${currentEmbuMode === 'reverse' ? 'selected' : ''}>Dibalik dari Babak 1 (Baku)</option>
                        <option value="redraw" ${currentEmbuMode === 'redraw' ? 'selected' : ''}>Diacak Ulang (Re-Draw)</option>
                        <option value="highscore" ${currentEmbuMode === 'highscore' ? 'selected' : ''}>Peringkat Nilai B1 (Tertinggi Tampil Terakhir)</option>
                    </select>

                   <h3 class="text-md font-black text-purple-400 mb-2 border-t border-slate-700 pt-3"><i class="fas fa-sitemap mr-2"></i>FORMAT BAGAN EMBU</h3>
                    <p class="text-[10px] text-slate-400 mb-3">Sistem penyisihan baku vs Head-to-Head.</p>
                    <select id="setting-embu-format" onchange="saveEmbuFormat()" class="w-full text-sm bg-slate-900 border border-slate-600 rounded p-2 text-white font-bold cursor-pointer hover:border-purple-500 transition-colors mb-4">
                        <option value="standard" ${(!STATE.settings || STATE.settings.embuFormat === 'standard' || !STATE.settings.embuFormat) ? 'selected' : ''}>Sistem Peringkat (Baku)</option>
                        <option value="h2h" ${(STATE.settings && STATE.settings.embuFormat === 'h2h') ? 'selected' : ''}>Double Elimination (Head-to-Head)</option>
                    </select>

                    <h3 class="text-md font-black text-cyan-400 mb-2 border-t border-slate-700 pt-4 mt-auto"><i class="fas fa-users-cog mr-2"></i>MAKSIMAL PESERTA POOL</h3>
                    <p class="text-[10px] text-slate-400 mb-3">Batas Kenshi per Pool (Embu Baku). Lebih dari ini = Dipecah Rata.</p>
                    <div class="flex items-center gap-2">
                        <input type="number" id="setting-max-pool-embu" min="4" value="${currentMaxPool}" class="w-full text-sm bg-slate-900 border border-slate-600 rounded p-2 text-white font-bold focus:border-cyan-500 outline-none transition-colors">
                        <button onclick="saveMaxPoolSetting()" class="bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2 px-5 rounded-lg transition-colors text-sm shadow-md">Simpan</button>
                    </div>
                </div>
            </div>
            
            <h2 class="text-xl font-black text-white mb-2"><i class="fas fa-download text-green-500 mr-2"></i>Pusat Export Data (Makro)</h2>
            <p class="text-sm text-slate-400 mb-6">Unduh seluruh rekapitulasi data global (semua kategori).</p>
            
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
               <button onclick="exportDrawingExcel()" class="bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 px-4 rounded-xl shadow-lg text-sm flex flex-col items-center justify-center gap-2 transition-transform hover:scale-105">
                    <i class="fas fa-list-ol text-2xl"></i>
                    <span class="text-center">Download Hasil<br>Drawing</span>
                </button>
                <button onclick="exportRekapJuaraCSV()" class="bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 px-4 rounded-xl shadow-lg text-sm flex flex-col items-center justify-center gap-2"><i class="fas fa-trophy text-2xl"></i><span class="text-center">Rekapitulasi<br>Pemenang</span></button>
                <button onclick="exportMedaliCSV()" class="bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-4 px-4 rounded-xl shadow-lg text-sm flex flex-col items-center justify-center gap-2"><i class="fas fa-medal text-2xl"></i><span class="text-center">Klasemen<br>Medali Akhir</span></button>
                
                <input type="file" id="excel-template-upload" accept=".xlsx" class="hidden" onchange="generateBaganExcel(event)">
                <button onclick="document.getElementById('excel-template-upload').click()" class="bg-green-700 border-2 border-green-500 hover:bg-green-600 text-white font-bold py-4 px-4 rounded-xl shadow-[0_0_15px_rgba(34,197,94,0.4)] text-sm flex flex-col items-center justify-center gap-2 transition-transform hover:scale-105">
                    <i class="fas fa-file-excel text-2xl"></i>
                    <span class="text-center">Cetak Bagan<br>(Excel)</span>
                </button>
            </div>
        `;
    }
}

// =========================================================
// LOGIKA KEAMANAN & PEMBATASAN AKSES PANITERA (RBAC) - REVISI 2
// =========================================================
const role = sessionStorage.getItem('role');
const courtId = sessionStorage.getItem('courtId');
const btnBack = document.getElementById('btn-back-portal');
const btnText = document.getElementById('text-back-portal');
const btnIcon = document.getElementById('icon-back-portal');

if (btnBack) {
    if (role === 'seksi_pertandingan') {
        btnText.innerText = "DASHBOARD";
        btnIcon.className = "fas fa-home";
        btnBack.classList.add('bg-indigo-600', 'hover:bg-indigo-500', 'hover:scale-105');
        btnBack.onclick = () => { window.location.href = '../dashboard.html'; };

    } else if (role === 'panitera') {
        btnText.innerText = "KELUAR";
        btnIcon.className = "fas fa-sign-out-alt";
        btnBack.classList.add('bg-red-600', 'hover:bg-red-500', 'border', 'border-red-400');
        btnBack.onclick = () => {
            if (confirm('Akhiri sesi penjurian untuk Court ini dan kembali ke portal utama?')) {
                sessionStorage.clear();
                window.location.href = '../index.html';
            }
        };

        const hiddenTabs = ['tab-kategori', 'tab-atlet', 'tab-timbang', 'tab-drawing', 'tab-ranking', 'tab-juara'];
        hiddenTabs.forEach(id => {
            const tab = document.getElementById(id);
            if (tab) tab.style.display = 'none';
        });

        setTimeout(() => switchTab('scoring'), 100);

        const roleSelect = document.getElementById('setting-device-role');
        if (roleSelect && courtId) {
            const safeCourtId = courtId.toLowerCase().replace(' ', '_');
            roleSelect.value = safeCourtId;
            DEVICE_ROLE = safeCourtId;
            localStorage.setItem('mass_device_role', safeCourtId);

            roleSelect.disabled = true;
            roleSelect.classList.add('opacity-60', 'cursor-not-allowed', 'bg-slate-900');

            // PAKSA TAMPILKAN TOMBOL TV MENGGUNAKAN JAVASCRIPT MURNI
            const btnTV = document.getElementById('btn-open-tv');
            if (btnTV) {
                btnTV.classList.remove('hidden');
                btnTV.style.display = 'flex';
                btnTV.href = `display.html?court=${safeCourtId}`;
            }
        }

        // SAPU BERSIH TAB ADMIN DENGAN JAVASCRIPT (Pasti Berhasil)
        setTimeout(() => {
            const adminContainer = document.querySelector('#section-admin .max-w-3xl');
            if (adminContainer) {
                Array.from(adminContainer.children).forEach(child => {
                    // Berikan pengecualian untuk 3 kotak: Broadcast, Paperless, DAN Integrasi (untuk diubah)
                    if (child.id !== 'admin-broadcast-zone' && child.id !== 'admin-paperless-zone' && child.id !== 'containerIntegrasi') {
                        child.style.display = 'none';
                    }
                });
            }

            // --- SUNTIKAN BARU: SULAP TOMBOL INTEGRASI JADI CACHE LOKAL ---
            const titleIntegrasi = document.getElementById("titleIntegrasi");
            const descIntegrasi = document.getElementById("descIntegrasi");
            const btnSync = document.getElementById("btnSyncData");

            if (titleIntegrasi && descIntegrasi && btnSync) {
                titleIntegrasi.innerHTML = "<i class='fas fa-download mr-2'></i>Tarik Data Atlet Lokal";
                descIntegrasi.innerText = "Simpan data jadwal dan waza khusus court ini ke memori laptop (Cache) agar siap dikirim ke wasit tanpa lag.";

                // Ubah gaya tombol jadi warna Hijau (Emerald)
                btnSync.innerHTML = "<i class='fas fa-save mr-2'></i>TARIK & SIMPAN DATA LOKAL";
                btnSync.className = "bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3 px-8 rounded-xl transition-transform hover:scale-105 shadow-[0_0_15px_rgba(16,185,129,0.5)] text-sm tracking-wider";

                // Ubah fungsinya jadi simpan lokal (STATE ke Cache) & sedot Waza ke memori Browser
                btnSync.onclick = async function () {
                    btnSync.innerHTML = "<i class='fas fa-spinner fa-spin mr-2'></i>Menyimpan & Menyedot Waza...";
                    btnSync.disabled = true;
                    try {
                        // 1. Simpan kerangka STATE (Jadwal, Bagan, Atlet) ke lokal
                        localStorage.setItem("CACHE_DATA_EMBU", JSON.stringify(STATE));

                        // 2. Operasi Kantung Samping: Sedot Waza & Simpan di Saku Browser
                        if (firestoreDB) {
                            let cacheWaza = {};
                            // Mengambil data murni dari rumah kedua (Firestore)
                            const snapshot = await firestoreDB.collection('pendaftaran_t2').get();

                            snapshot.forEach(doc => {
                                let data = doc.data();
                                if (data.waza && Array.isArray(data.waza)) {
                                    cacheWaza[doc.id] = data.waza; // Gunakan idFirestore sebagai kunci gembok
                                }
                            });

                            // Kunci brankas Waza murni di Local Storage browser panitera
                            localStorage.setItem("CACHE_WAZA_EMBU", JSON.stringify(cacheWaza));
                        } else {
                            console.warn("Mesin Firestore mati. Hanya menyimpan kerangka STATE lokal.");
                        }

                        btnSync.innerHTML = "<i class='fas fa-check-circle mr-2'></i>DATA & WAZA TERSIMPAN";

                        // Kembalikan tombol ke wujud semula setelah 2 detik
                        setTimeout(() => {
                            btnSync.innerHTML = "<i class='fas fa-save mr-2'></i>TARIK & SIMPAN DATA LOKAL";
                            btnSync.disabled = false;
                        }, 2000);

                    } catch (err) {
                        console.error("Gagal sync Waza:", err);
                        alert("Gagal sinkronisasi Waza ke lokal. Pastikan internet aktif (Mode Hybrid) saat menarik data Waza.");
                        btnSync.innerHTML = "<i class='fas fa-exclamation-triangle mr-2'></i>GAGAL SINKRON";
                        setTimeout(() => {
                            btnSync.innerHTML = "<i class='fas fa-save mr-2'></i>TARIK & SIMPAN DATA LOKAL";
                            btnSync.disabled = false;
                        }, 2000);
                    }
                };
            }
        }, 150);
    }
}

function saveTournamentMode() {
    if (!STATE.settings) STATE.settings = {};
    STATE.settings.tournamentMode = document.getElementById('setting-tournament-mode').value;
    saveToLocalStorage();
    alert("Sistem penyisihan berhasil diubah menjadi: " + (STATE.settings.tournamentMode === 'single' ? "SINGLE ELIMINATION" : "DOUBLE ELIMINATION"));
}
function saveFinalMode() {
    if (!STATE.settings) STATE.settings = {};
    STATE.settings.finalRandoriMode = document.getElementById('setting-final-mode').value;
    saveToLocalStorage();
    alert("Sistem Final Randori (Crossover) berhasil disimpan.");
}

function saveEmbuB2Mode() {
    if (!STATE.settings) STATE.settings = {};
    const newMode = document.getElementById('setting-embu-mode').value;
    STATE.settings.embuB2Mode = newMode;

    let syncUpdates = {};

    // KUNCI ATOMIK: Masukkan setting langsung ke dalam paket Firebase!
    syncUpdates['turnamen_data/settings/embuB2Mode'] = newMode;

    let hasUpdates = false;

    // Looping keliling ke semua kategori Embu
    STATE.categories.filter(c => c.discipline === 'embu').forEach(cat => {
        let list = STATE.participants.filter(p => p.kategori === cat.name && p.urut > 0);

        // Hanya proses yang jalurnya Single Pool
        if (list.length > 0 && !list.some(p => p.pool !== '-' && p.pool !== 'SINGLE')) {
            if (newMode === 'reverse') {
                let sorted = [...list].sort((a, b) => b.urut - a.urut);
                sorted.forEach((p, i) => {
                    p.urutB2 = i + 1;
                    let idx = STATE.participants.findIndex(x => x.id === p.id);
                    syncUpdates[`turnamen_data/participants/${idx}/urutB2`] = i + 1;
                    hasUpdates = true;
                });
            } else if (newMode === 'highscore') {
                let hasPlayed = list.filter(p => p.scores.b1.final > 0);
                let sorted = hasPlayed.sort((a, b) => a.scores.b1.final - b.scores.b1.final || a.scores.b1.tech - b.scores.b1.tech);
                list.forEach(p => {
                    let rankIdx = sorted.findIndex(x => x.id === p.id);
                    let newUrut = rankIdx > -1 ? rankIdx + 1 : 0; // 0 jika belum main B1
                    if (p.urutB2 !== newUrut) {
                        p.urutB2 = newUrut;
                        let idx = STATE.participants.findIndex(x => x.id === p.id);
                        syncUpdates[`turnamen_data/participants/${idx}/urutB2`] = newUrut;
                        hasUpdates = true;
                    }
                });
            } else if (newMode === 'redraw') {
                list.forEach(p => {
                    if (p.urutB2 !== 0) {
                        p.urutB2 = 0; // Reset ke 0 agar wajib diundi ulang
                        let idx = STATE.participants.findIndex(x => x.id === p.id);
                        syncUpdates[`turnamen_data/participants/${idx}/urutB2`] = 0;
                        hasUpdates = true;
                    }
                });
            }
        }
    });

    // Tembak massal ke Firebase! (Pasti tereksekusi karena kita mengunggah setting)
    database.ref().update(syncUpdates).then(() => {
        alert("Aturan Urutan Babak 2 berhasil disimpan" + (hasUpdates ? " & Posisi Atlet disinkronisasi!" : "!"));
        checkExistingDrawing();
        filterPesertaScoring();
    }).catch(err => alert("Gagal Sinkronisasi: " + err));
}

function saveEmbuFormat() {
    if (!STATE.settings) STATE.settings = {};
    STATE.settings.embuFormat = document.getElementById('setting-embu-format').value;
    saveToLocalStorage();
    alert("Format Bagan Embu berhasil diubah menjadi: " + (STATE.settings.embuFormat === 'h2h' ? "Double Elimination (H2H)" : "Sistem Peringkat (Baku)"));
}

function refreshAllData() {
    renderCategoryList();
    updateAllDropdowns();
    renderParticipantTable();
    filterPesertaScoring(); // FIX BUG 1: Langsung muat daftar atlet di tab Scoring saat web dibuka
}

function switchTab(targetTab) {
    UI.tabs.forEach(tab => {
        const sectionEl = document.getElementById(`section-${tab}`); const tabEl = document.getElementById(`tab-${tab}`);
        if (sectionEl) { sectionEl.classList.add('hidden'); sectionEl.classList.remove('block'); }
        if (tabEl) { tabEl.classList.remove('active-tab', 'text-blue-500', 'text-red-400', 'text-yellow-400'); if (tab === 'admin') tabEl.classList.add('text-red-400'); else if (tab === 'juara') tabEl.classList.add('text-yellow-500'); else tabEl.classList.add('text-slate-400'); }
    });
    const activeSection = document.getElementById(`section-${targetTab}`); const activeTab = document.getElementById(`tab-${targetTab}`);
    if (activeSection) { activeSection.classList.remove('hidden'); activeSection.classList.add('block'); }
    if (activeTab) { if (targetTab === 'admin') { activeTab.classList.remove('text-red-400'); activeTab.classList.add('active-tab', 'text-red-500'); } else if (targetTab === 'juara') { activeTab.classList.remove('text-yellow-500'); activeTab.classList.add('active-tab', 'text-yellow-400'); } else { activeTab.classList.remove('text-slate-400'); activeTab.classList.add('active-tab', 'text-blue-500'); } }

    // --- FIX BUG SCORING KOSONG: ---
    // PENGAMAN ABSOLUT: Pastikan dropdown terisi ulang saat tab diklik
    updateAllDropdowns();

    // Paksa gambar ulang data SAAT tab diklik 
    if (targetTab === 'kategori') renderCategoryList();
    if (targetTab === 'atlet') renderParticipantTable();
    if (targetTab === 'ranking') renderRanking();
    if (targetTab === 'jadwal') renderJadwalList();
    if (targetTab === 'scoring') filterPesertaScoring();
    if (targetTab === 'drawing') { SWAP_SELECTION = null; checkExistingDrawing(); }
    if (targetTab === 'juara') renderJuaraUmum();
    if (targetTab === 'admin') {
        let minEl = document.getElementById('setting-min-peserta');
        if (minEl) minEl.value = (STATE.settings && STATE.settings.minPesertaJuara) ? STATE.settings.minPesertaJuara : 1;

        let modeEl = document.getElementById('setting-tournament-mode');
        if (modeEl) modeEl.value = (STATE.settings && STATE.settings.tournamentMode) ? STATE.settings.tournamentMode : 'double';

        let judulEl = document.getElementById('setting-judul-tv');
        if (judulEl) judulEl.value = (STATE.settings && STATE.settings.judulTV) ? STATE.settings.judulTV : "KEJUARAAN NASIONAL BELADIRI SENI 2024";

        let maxPoolEl = document.getElementById('setting-max-pool-embu');
        if (maxPoolEl) maxPoolEl.value = (STATE.settings && STATE.settings.maxPesertaPoolEmbu) ? STATE.settings.maxPesertaPoolEmbu : 12;

        // 👇 TAMBAHKAN 2 BARIS INI DI SINI JUGA 👇
        let eksibisiEl = document.getElementById('setting-eksibisi-final');
        if (eksibisiEl) eksibisiEl.checked = !!(STATE.settings && STATE.settings.eksibisiLangsungFinal);

        // 👇 TAMBAHKAN 2 BARIS INI DI SINI JUGA 👇
        let embuB2El = document.getElementById('setting-embu-mode');
        if (embuB2El) embuB2El.value = (STATE.settings && STATE.settings.embuB2Mode) ? STATE.settings.embuB2Mode : 'reverse';

        // 🌟 TAMBAHKAN KODE INI UNTUK SINKRONISASI FORMAT H2H 🌟
        let embuFormatEl = document.getElementById('setting-embu-format');
        if (embuFormatEl) embuFormatEl.value = (STATE.settings && STATE.settings.embuFormat) ? STATE.settings.embuFormat : 'standard';

        let vfEl = document.getElementById('setting-verifikator');
        if (vfEl) vfEl.checked = !!(STATE.settings && STATE.settings.enableVerifikator);

    }
}
document.getElementById('form-kategori').addEventListener('submit', (e) => { e.preventDefault(); const name = document.getElementById('cat-name').value.trim(); const type = parseInt(document.getElementById('cat-type').value); const discipline = document.getElementById('cat-discipline').value; if (!name) return; if (STATE.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) return alert("Kategori sudah ada!"); STATE.categories.push({ id: Date.now(), name, type, discipline }); saveToLocalStorage(); refreshAllData(); e.target.reset(); });
function renderCategoryList() { const container = document.getElementById('list-kategori'); if (STATE.categories.length === 0) return container.innerHTML = `<span class="text-sm text-slate-500 italic">Belum ada kategori.</span>`; container.innerHTML = STATE.categories.map(c => { let badgeColor = c.discipline === 'randori' ? 'bg-red-700' : (c.discipline === 'festival' ? 'bg-green-600' : 'bg-blue-600'); let disciplineText = c.discipline ? c.discipline.toUpperCase() : 'EMBU'; return `<div class="bg-slate-800 px-4 py-2 rounded-lg text-sm flex items-center gap-3 border border-slate-700 shadow-sm"><span class="${badgeColor} text-[9px] px-1.5 py-0.5 rounded font-bold">${disciplineText}</span><span class="font-bold text-white">${c.name}</span><span class="bg-slate-700 text-[10px] px-2 py-0.5 rounded text-slate-300">${c.type} Org</span><button onclick="deleteCategory(${c.id})" class="text-slate-500 hover:text-red-400 ml-2"><i class="fas fa-times"></i></button></div>` }).join(''); }
function deleteCategory(id) {
    if (confirm("🚨 BAHAYA!\n\nHapus kategori ini?\n\nPERHATIAN: Seluruh data ATLET dan BAGAN PERTANDINGAN yang ada di dalam kategori ini juga akan IKUT TERHAPUS PERMANEN!\n\nLanjutkan?")) {

        const cat = STATE.categories.find(c => c.id === id);

        if (cat) {
            // EKSEKUSI CASCADING DELETE: Bakar semua data yang terhubung
            STATE.participants = STATE.participants.filter(p => p.kategori !== cat.name);
            STATE.matches = STATE.matches.filter(m => m.kategori !== cat.name);
        }

        // Hapus nama kategorinya
        STATE.categories = STATE.categories.filter(c => c.id !== id);

        saveToLocalStorage();
        refreshAllData();
    }
}

function updateAllDropdowns() {
    // Pengaman Anti-Crash
    const elP = document.getElementById('p-kategori');
    const elEdit = document.getElementById('edit-kategori');
    const elDraw = document.getElementById('draw-select-kategori');
    const elSelect = document.getElementById('select-kategori');
    const elRank = document.getElementById('rank-filter-kategori');
    const elFilterAtlet = document.getElementById('filter-atlet-kategori');

    // 1. Simpan memori dengan aman
    const valP = elP ? elP.value : null;
    const valEdit = elEdit ? elEdit.value : null;
    const valDraw = elDraw ? elDraw.value : null;
    const valSelect = elSelect ? elSelect.value : null;
    const valRank = elRank ? elRank.value : null;
    const valFilterAtlet = elFilterAtlet ? elFilterAtlet.value : null;

    // 2. Buat ulang daftar <option>
    const options = STATE.categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    const emptyOpt = `<option value="">-- Pilih Kategori --</option>`;
    const allOpt = '<option value="all">Semua Kategori</option>';

    // 3. Masukkan daftar baru (HANYA jika elemennya ada)
    if (elP) elP.innerHTML = emptyOpt + options;
    if (elEdit) elEdit.innerHTML = emptyOpt + options;
    if (elDraw) elDraw.innerHTML = emptyOpt + options;
    if (elSelect) elSelect.innerHTML = emptyOpt + options;
    if (elRank) elRank.innerHTML = emptyOpt + options;
    if (elFilterAtlet) elFilterAtlet.innerHTML = allOpt + options;

    // 4. Kembalikan pilihan user
    if (valP && elP) elP.value = valP;
    if (valEdit && elEdit) elEdit.value = valEdit;
    if (valDraw && elDraw) elDraw.value = valDraw;
    if (valSelect && elSelect) elSelect.value = valSelect;
    if (valRank && elRank) elRank.value = valRank;
    if (valFilterAtlet && elFilterAtlet) elFilterAtlet.value = valFilterAtlet;
}

function handleCSVUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const rows = e.target.result.split('\n');
        let count = 0;
        rows.forEach((row, i) => {
            if (i === 0 || !row.trim()) return;
            let cols = []; let curr = ''; let inQuotes = false;
            for (let char of row) {
                if (char === '"') inQuotes = !inQuotes;
                else if (char === ',' && !inQuotes) { cols.push(curr); curr = ''; }
                else curr += char;
            }
            cols.push(curr);
            cols = cols.map(item => item.replace(/^"|"$/g, '').trim());

            if (cols.length >= 3) {
                const nama = cols[0], kontingen = cols[1], kategori = cols[2];

                // --- PROTEKSI & PARSING KOLOM BARU ---
                let kyuRaw = cols[3] ? String(cols[3]).trim() : "";
                // Memeras hanya angka, sekotor apa pun ketikannya (misal: "15 Thn" jadi 15)
                let umurRaw = cols[4] ? parseInt(String(cols[4]).replace(/\D/g, '')) || 0 : 0;

                if (nama && STATE.categories.some(c => c.name.toLowerCase() === kategori.toLowerCase())) {
                    STATE.participants.push({
                        id: Date.now() + i,
                        idFirestore: "", // <--- TAMBAHAN: Tanda import lokal manual
                        nama, kontingen, kategori,
                        kyu: kyuRaw, umur: umurRaw,
                        urut: 0, pool: '-', isFinalist: false, urutFinal: 0, losses: 0,
                        scores: { b1: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 }, b2: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 } },
                        finalScore: 0, techScore: 0
                    });
                    count++;
                }
            }
        });
        saveToLocalStorage(); refreshAllData(); event.target.value = ''; alert(`${count} Tim/Atlet diimport sukses.`);
    };
    reader.readAsText(file);
}

// Fungsi Baru: Upload CSV Khusus Kategori (Mendukung Festival)
function handleCategoryCSVUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const rows = e.target.result.split('\n');
        let count = 0;
        rows.forEach((row, i) => {
            if (i === 0 || !row.trim()) return; // Lewati baris pertama (header)
            let cols = row.split(',').map(item => item.replace(/^"|"$/g, '').trim());
            if (cols.length >= 3) {

                // --- FIX ALGORITMA IMPORT DISIPLIN ---
                let discRaw = cols[0].toLowerCase();
                let discipline = discRaw.includes('randori') ? 'randori' : (discRaw.includes('festival') ? 'festival' : 'embu');

                const name = cols[1];
                const type = parseInt(cols[2]) || 1;

                // Cek agar tidak duplikat
                if (name && !STATE.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
                    STATE.categories.push({ id: Date.now() + i, name, type, discipline });
                    count++;
                }
            }
        });
        saveToLocalStorage(); refreshAllData(); event.target.value = ''; alert(`${count} Kategori berhasil diimport.`);
    };
    reader.readAsText(file);
}
// Fungsi Baru: Simpan Setting Minimal Peserta
function saveJudulTV() {
    const val = document.getElementById('setting-judul-tv').value;
    if (!val) return alert("Judul tidak boleh kosong!");
    if (!STATE.settings) STATE.settings = {};

    STATE.settings.judulTV = val.toUpperCase();
    saveToLocalStorage(); // Ini akan otomatis menembak ke Firebase!
    alert("Sip! Judul TV berhasil diubah menjadi:\n" + val.toUpperCase());
}

// ==============================================================
// SISTEM PENGATURAN TV BROADCAST & TIMER HITUNG MUNDUR (RANDORI)
// ==============================================================

// 1. Memori Pengaturan TV LOKAL
let SETTING_TV = {
    zoom: 1.0,
    embuWaza: true,
    embuTech: true,
    embuTimerLive: false,
    randoriTimerLive: true,
    randoriMinutes: 2,
    wallpaperBase64: null
};

// 2. Fungsi Buka Modal & Tarik Data
function bukaModalSettingTV() {
    // Tarik dari Local Storage jika ada
    let saved = localStorage.getItem('mass_setting_tv');
    if (saved) {
        try { SETTING_TV = JSON.parse(saved); } catch (e) { }
    }

    document.getElementById('tv-zoom-slider').value = SETTING_TV.zoom;
    document.getElementById('tv-zoom-value').innerText = SETTING_TV.zoom.toFixed(1) + "x";

    document.getElementById('tv-embu-show-waza').checked = SETTING_TV.embuWaza;
    document.getElementById('tv-embu-show-tech').checked = SETTING_TV.embuTech;
    document.getElementById('tv-embu-live-timer').checked = SETTING_TV.embuTimerLive;

    document.getElementById('tv-randori-live-timer').checked = SETTING_TV.randoriTimerLive;
    document.getElementById('tv-randori-minutes').value = SETTING_TV.randoriMinutes;

    if (SETTING_TV.wallpaperBase64) {
        document.getElementById('tv-wallpaper-status').classList.remove('hidden');
        document.getElementById('btn-hapus-wallpaper').classList.remove('hidden');
    } else {
        document.getElementById('tv-wallpaper-status').classList.add('hidden');
        document.getElementById('btn-hapus-wallpaper').classList.add('hidden');
    }

    document.getElementById('modal-setting-tv').classList.remove('hidden');
}

// 3. Animasi Angka Slider
const sliderZoom = document.getElementById('tv-zoom-slider');
if (sliderZoom) {
    sliderZoom.addEventListener('input', function () {
        document.getElementById('tv-zoom-value').innerText = parseFloat(this.value).toFixed(1) + "x";
    });
}

// 4. Kompresi Gambar Wallpaper ke Base64 (Agar tidak membebani Firebase/Socket)
const uploadWall = document.getElementById('tv-wallpaper-upload');
if (uploadWall) {
    uploadWall.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;

        // Validasi Ukuran (Maks 1MB untuk performa)
        if (file.size > 1024 * 1024) {
            alert("Ukuran gambar terlalu besar! Maksimal 1MB agar siaran TV tidak lag.");
            this.value = ''; return;
        }

        const reader = new FileReader();
        reader.onload = function (event) {
            SETTING_TV.wallpaperBase64 = event.target.result;
            document.getElementById('tv-wallpaper-status').classList.remove('hidden');
            document.getElementById('btn-hapus-wallpaper').classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    });
}

function hapusWallpaperTV() {
    SETTING_TV.wallpaperBase64 = null;
    document.getElementById('tv-wallpaper-upload').value = '';
    document.getElementById('tv-wallpaper-status').classList.add('hidden');
    document.getElementById('btn-hapus-wallpaper').classList.add('hidden');
}

// 5. Simpan & Pancarkan Pengaturan ke TV
function simpanSettingTV() {
    SETTING_TV.zoom = parseFloat(document.getElementById('tv-zoom-slider').value);
    SETTING_TV.embuWaza = document.getElementById('tv-embu-show-waza').checked;
    SETTING_TV.embuTech = document.getElementById('tv-embu-show-tech').checked;
    SETTING_TV.embuTimerLive = document.getElementById('tv-embu-live-timer').checked;
    SETTING_TV.randoriTimerLive = document.getElementById('tv-randori-live-timer').checked;
    SETTING_TV.randoriMinutes = parseInt(document.getElementById('tv-randori-minutes').value) || 2;

    localStorage.setItem('mass_setting_tv', JSON.stringify(SETTING_TV));

    // Tembak pengaturan ke TV (Menggunakan Socket Lokal & Firebase)
    let payload = { type: 'setting_update', config: SETTING_TV };
    if (typeof localSocket !== 'undefined' && localSocket) {
        localSocket.emit('broadcast_to_tv', { channel: 'global_tv', court: DEVICE_ROLE, payload: payload });
    }
    if (database) database.ref(`live_broadcast/${DEVICE_ROLE}_config`).set(payload).catch(e => console.warn(e));

    document.getElementById('modal-setting-tv').classList.add('hidden');
    alert("✅ Pengaturan berhasil diterapkan ke TV!");

    // Auto-Reset Timer jika Randori aktif agar menyesuaikan setting baru
    resetTimer();
}

// 6. 🚨 PEROMBAKAN MESIN TIMER (Mendukung Hitung Mundur Randori) 🚨
let RANDORI_COUNTDOWN_ACTIVE = false;

// Membajak fungsi asli
const originalResetTimer = resetTimer;
resetTimer = function () {
    if (UI.timerInterval) { clearInterval(UI.timerInterval); UI.timerInterval = null; }

    const catName = document.getElementById('select-kategori') ? document.getElementById('select-kategori').value : '';
    const catObj = STATE.categories.find(c => c.name === catName);
    const isRandori = catObj && catObj.discipline === 'randori';

    let saved = localStorage.getItem('mass_setting_tv');
    if (saved) { try { SETTING_TV = JSON.parse(saved); } catch (e) { } }

    if (isRandori) {
        RANDORI_COUNTDOWN_ACTIVE = true;
        UI.timerSeconds = (SETTING_TV.randoriMinutes || 2) * 60;
    } else {
        RANDORI_COUNTDOWN_ACTIVE = false;
        UI.timerSeconds = 0;
    }

    updateTimerUI();
    document.getElementById('btn-timer').innerText = 'START';
    document.getElementById('btn-timer').className = 'flex-1 bg-green-600 hover:bg-green-500 px-4 py-2 rounded-lg font-bold transition-colors';

    if (!isRandori) calculateLive();

    // 🔥 Broadcast Sinyal RESET ke TV
    broadcastTimerCommand('reset', UI.timerSeconds);
};

// Membajak fungsi Toggle
const originalToggleTimer = toggleTimer;
toggleTimer = function () {
    const btn = document.getElementById('btn-timer');
    if (UI.timerInterval) {
        // STOP TIMER
        clearInterval(UI.timerInterval); UI.timerInterval = null;
        btn.innerText = 'LANJUT';
        btn.classList.replace('bg-red-600', 'bg-yellow-600');
        btn.classList.replace('hover:bg-red-500', 'hover:bg-yellow-500');

        // 🔥 Broadcast Sinyal STOP ke TV
        broadcastTimerCommand('stop', UI.timerSeconds);
    } else {
        // START TIMER
        UI.timerInterval = setInterval(() => {
            if (RANDORI_COUNTDOWN_ACTIVE) {
                if (UI.timerSeconds > 0) UI.timerSeconds--;
                if (UI.timerSeconds <= 0) {
                    clearInterval(UI.timerInterval); UI.timerInterval = null;
                    btn.innerText = 'HABIS';
                    btn.classList.replace('bg-red-600', 'bg-slate-600');
                    broadcastTimerCommand('stop', 0);
                }
            } else {
                UI.timerSeconds++;
            }
            updateTimerUI();
            if (!RANDORI_COUNTDOWN_ACTIVE) calculateLive();
        }, 1000);

        btn.innerText = 'STOP';
        btn.className = 'flex-1 bg-red-600 hover:bg-red-500 px-4 py-2 rounded-lg font-bold transition-colors';

        // 🔥 Broadcast Sinyal START ke TV
        broadcastTimerCommand('start', UI.timerSeconds);
    }
};

// =========================================================
// PENGIRIM SINYAL KONTROL TIMER TV (HEMAT KUOTA)
// =========================================================
function broadcastTimerCommand(action, currentSec = 0) {
    if (DEVICE_ROLE === 'admin' || !IS_TV_LIVE) return;

    // Tarik setting TV lokal dengan fallback default aktif
    let saved = localStorage.getItem('mass_setting_tv');
    let settingTV = { embuTimerLive: true };
    if (saved) {
        try {
            let parsed = JSON.parse(saved);
            if (parsed.embuTimerLive !== undefined) settingTV.embuTimerLive = parsed.embuTimerLive;
        } catch (e) { }
    }

    const catName = document.getElementById('select-kategori') ? document.getElementById('select-kategori').value : '';
    const catObj = STATE.categories.find(c => c.name === catName);
    const isRandori = catObj && catObj.discipline === 'randori';

    // Lewati hanya jika panitera sengaja mematikan timer embu di modal setting
    if (!isRandori && settingTV.embuTimerLive === false) return;

    const payload = {
        type: 'timer_sync',
        action: action,
        seconds: currentSec,
        timestamp: Date.now()
    };

    // 1. Kirim via Jaringan Lokal (Socket.io)
    if (typeof localSocket !== 'undefined' && localSocket && localSocket.connected) {
        localSocket.emit('broadcast_to_tv', { channel: 'global_tv', court: DEVICE_ROLE, payload: payload });
    }

    // 2. Kirim via Firebase RTDB
    if (database) {
        database.ref(`live_broadcast/${DEVICE_ROLE}/timer_sync`).set(payload).catch(e => console.warn(e));
    }
}

// Injeksi otomatis saat halaman pertama dimuat
document.addEventListener('DOMContentLoaded', () => {
    let saved = localStorage.getItem('mass_setting_tv');
    if (saved) { try { SETTING_TV = JSON.parse(saved); } catch (e) { } }
});

function saveEksibisiSetting() {
    if (!STATE.settings) STATE.settings = {};
    STATE.settings.eksibisiLangsungFinal = document.getElementById('setting-eksibisi-final').checked;
    saveToLocalStorage();
}

function saveMinPesertaSetting() {
    const val = parseInt(document.getElementById('setting-min-peserta').value);
    if (!val || val < 1) return alert("Angka minimal adalah 1.");
    if (!STATE.settings) STATE.settings = {};
    STATE.settings.minPesertaJuara = val;
    saveToLocalStorage();
    alert("Syarat Minimal Peserta diperbarui menjadi " + val);
    renderJuaraUmum();
}

document.getElementById('form-peserta').addEventListener('submit', (e) => {
    e.preventDefault();
    const catName = document.getElementById('p-kategori').value;
    if (!catName) return alert("Pilih kategori!");
    STATE.participants.push({
        id: Date.now(),
        idFirestore: "", // <--- TAMBAHAN: Tanda bahwa ini "Warga Lokal Lapangan"
        nama: document.getElementById('p-nama').value,
        kontingen: document.getElementById('p-kontingen').value,
        kategori: catName,
        kyu: "", umur: 0,
        urut: 0, pool: '-', isFinalist: false, urutFinal: 0, losses: 0,
        scores: { b1: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 }, b2: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 } },
        finalScore: 0, techScore: 0
    });
    saveToLocalStorage();
    renderParticipantTable();
    document.getElementById('p-nama').value = '';
    document.getElementById('p-nama').focus();
});

function saveMaxPoolSetting() {
    const val = parseInt(document.getElementById('setting-max-pool-embu').value);
    if (!val || val < 4) return alert("Angka minimal untuk batas Pool adalah 4.");

    if (!STATE.settings) STATE.settings = {};
    STATE.settings.maxPesertaPoolEmbu = val;

    saveToLocalStorage(); // Otomatis nembak ke server Firebase
    alert("Batas Maksimal Peserta per Pool (Embu) berhasil diperbarui menjadi " + val);
}

function renderParticipantTable(resetPage = false) {
    if (resetPage) currentAthletePage = 1; // Reset ke halaman 1 jika filter atau pencarian berubah

    const body = document.getElementById('table-peserta-body');
    const filterEl = document.getElementById('filter-atlet-kategori');
    const filter = filterEl ? filterEl.value : 'all';
    
    const searchInput = document.getElementById('search-atlet');
    const searchTxt = searchInput ? searchInput.value.toLowerCase().trim() : '';

    // 1. Filter Kategori
    let list = filter && filter !== 'all' ? STATE.participants.filter(p => p.kategori === filter) : STATE.participants;

    // 2. Filter Pencarian Teks (HANYA AKTIF JIKA MINIMAL 3 HURUF)
    if (searchTxt.length >= 3) {
        list = list.filter(p => 
            (p.nama && p.nama.toLowerCase().includes(searchTxt)) || 
            (p.kontingen && p.kontingen.toLowerCase().includes(searchTxt))
        );
    }

    // --- UPDATE UI PAGINATION ---
    const totalItems = list.length;
    const totalPages = Math.ceil(totalItems / ATHLETES_PER_PAGE) || 1;
    if (currentAthletePage > totalPages) currentAthletePage = totalPages;

    const infoEl = document.getElementById('pagination-info');
    const btnPrev = document.getElementById('btn-prev-page');
    const btnNext = document.getElementById('btn-next-page');

    if (totalItems === 0) {
        if (infoEl) infoEl.innerText = `Menampilkan 0 atlet`;
        if (btnPrev) btnPrev.disabled = true;
        if (btnNext) btnNext.disabled = true;

        let emptyMsg = searchTxt.length >= 3 
            ? `Tidak ada atlet yang cocok dengan kata kunci "<b>${searchTxt}</b>".` 
            : `Tidak ada data peserta.`;
        return body.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-slate-500 text-xs">${emptyMsg}</td></tr>`;
    }

    const startIndex = (currentAthletePage - 1) * ATHLETES_PER_PAGE;
    const endIndex = Math.min(startIndex + ATHLETES_PER_PAGE, totalItems);

    if (infoEl) infoEl.innerText = `Menampilkan ${startIndex + 1} - ${endIndex} dari ${totalItems} Atlet`;
    if (btnPrev) btnPrev.disabled = currentAthletePage === 1;
    if (btnNext) btnNext.disabled = currentAthletePage === totalPages;
    // ----------------------------

    let sortedList = [...list].sort((a, b) => a.kategori === b.kategori ? a.urut - b.urut : a.kategori.localeCompare(b.kategori));

    // Potong data per halaman (Max 50)
    let paginatedList = sortedList.slice(startIndex, endIndex);

    // --- MEMOIZATION HASIL RANDORI ---
    let cachedRandoriResults = {};
    let cachedRandoriDrawn = {};
    let uniqueCategories = [...new Set(paginatedList.map(p => p.kategori))];

    uniqueCategories.forEach(catName => {
        let catObj = STATE.categories.find(c => c.name === catName);
        if (catObj && catObj.discipline === 'randori') {
            let isDrawn = STATE.matches.some(m => m.kategori === catName);
            cachedRandoriDrawn[catName] = isDrawn;
            if (isDrawn) {
                cachedRandoriResults[catName] = calculateRandoriFinalists(catName);
            }
        }
    });

    body.innerHTML = paginatedList.map(p => {
        let catObj = STATE.categories.find(c => c.name === p.kategori);
        let isRandori = catObj && catObj.discipline === 'randori';
        let isRandoriDrawn = isRandori ? cachedRandoriDrawn[p.kategori] : false;

        let baseStatus = '';
        let resultBadge = '';

        // 1. Tentukan Status Undian
        if (isRandori) {
            if (isRandoriDrawn) {
                baseStatus = p.pool !== '-' ? `POOL ${p.pool}` : 'Bagan Utama';
            } else {
                baseStatus = `<span class="text-red-400 italic">Belum Undian</span>`;
            }
        } else {
            if (p.urut > 0) {
                let poolLabel = p.pool !== '-' && p.pool !== 'SINGLE' ? ` | POOL ${p.pool}` : '';
                baseStatus = `No.${p.urut}${poolLabel}`;
            } else {
                baseStatus = `<span class="text-red-400 italic">Belum Undian</span>`;
            }
        }

        // 2. Tentukan Lencana Juara / Gugur
        let isJuara = false;

        if (isRandori && isRandoriDrawn) {
            const poolResults = cachedRandoriResults[p.kategori];
            if (poolResults) {
                poolResults.forEach(res => {
                    if (res.emas === p.nama) {
                        isJuara = true; resultBadge = `<span class="bg-yellow-500 text-black text-[10px] px-2 py-0.5 rounded ml-2 font-bold shadow-sm">Juara 1</span>`;
                    } else if (res.perak === p.nama) {
                        isJuara = true; resultBadge = `<span class="bg-slate-300 text-black text-[10px] px-2 py-0.5 rounded ml-2 font-bold shadow-sm">Juara 2</span>`;
                    } else if (res.perunggu.some(br => br.nama === p.nama)) {
                        isJuara = true; resultBadge = `<span class="bg-amber-600 text-white text-[10px] px-2 py-0.5 rounded ml-2 font-bold shadow-sm">Juara 3</span>`;
                    }
                });
            }
        } else if (!isRandori && p.urut > 0) {
            if (p.isFinalist && p.scores.b2.final > 0) {
                let catParts = STATE.participants.filter(x => x.kategori === p.kategori && x.isFinalist && x.scores.b2.final > 0).sort((a, b) => b.scores.b2.final - a.scores.b2.final || b.scores.b2.tech - a.scores.b2.tech);
                let rank = catParts.findIndex(x => x.id === p.id);
                if (rank === 0) { isJuara = true; resultBadge = `<span class="bg-yellow-500 text-black text-[10px] px-2 py-0.5 rounded ml-2 font-bold shadow-sm">Juara 1</span>`; }
                else if (rank === 1) { isJuara = true; resultBadge = `<span class="bg-slate-300 text-black text-[10px] px-2 py-0.5 rounded ml-2 font-bold shadow-sm">Juara 2</span>`; }
                else if (rank === 2) { isJuara = true; resultBadge = `<span class="bg-amber-600 text-white text-[10px] px-2 py-0.5 rounded ml-2 font-bold shadow-sm">Juara 3</span>`; }
            } else if (!p.isFinalist && p.scores.b1.final > 0 && !STATE.participants.some(x => x.kategori === p.kategori && x.isFinalist)) {
                let catParts = STATE.participants.filter(x => x.kategori === p.kategori && x.pool === p.pool && x.scores.b1.final > 0).sort((a, b) => b.scores.b1.final - a.scores.b1.final || b.scores.b1.tech - a.scores.b1.tech);
                let rank = catParts.findIndex(x => x.id === p.id);
                if (rank === 0) { isJuara = true; resultBadge = `<span class="bg-yellow-500 text-black text-[10px] px-2 py-0.5 rounded ml-2 font-bold shadow-sm">Juara 1</span>`; }
                else if (rank === 1) { isJuara = true; resultBadge = `<span class="bg-slate-300 text-black text-[10px] px-2 py-0.5 rounded ml-2 font-bold shadow-sm">Juara 2</span>`; }
                else if (rank === 2) { isJuara = true; resultBadge = `<span class="bg-amber-600 text-white text-[10px] px-2 py-0.5 rounded ml-2 font-bold shadow-sm">Juara 3</span>`; }
            }
        }

        if (!isJuara) {
            let isDrawn = isRandori ? isRandoriDrawn : p.urut > 0;
            if (p.losses === 1 && isDrawn) resultBadge = `<span class="bg-orange-600 text-white text-[10px] px-1.5 py-0.5 rounded ml-2 font-bold shadow-sm">Loser Bracket</span>`;
            else if (p.losses >= 2 && isDrawn) resultBadge = `<span class="bg-red-800 text-white text-[10px] px-1.5 py-0.5 rounded ml-2 font-bold shadow-sm">Gugur</span>`;
        }

        let statusHTML = `<div class="text-xs text-blue-300 font-semibold mt-1 flex items-center">${baseStatus} ${resultBadge}</div>`;

        return `<tr class="border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
            <td class="p-3 align-top font-bold text-blue-300 w-[35%] whitespace-normal break-words leading-tight">
                ${p.nama} ${p.isFinalist ? '<br><span class="text-[10px] text-yellow-500 font-bold mt-1">FINALIS</span>' : ''}
            </td>
            <td class="p-3 align-top w-[25%] whitespace-normal break-words text-sm text-slate-200">
                ${p.kontingen}
            </td>
            <td class="p-3 align-top text-xs text-slate-400 w-[25%] whitespace-normal break-words leading-relaxed">
                <span class="text-blue-400 font-semibold">${p.kategori}</span>${statusHTML}
            </td>
            <td class="p-3 align-top text-right w-[15%] whitespace-nowrap">
                <button onclick="openEditModal(${p.id})" class="text-blue-400 mr-2 hover:bg-blue-900/50 p-2 rounded transition-colors"><i class="fas fa-edit"></i></button>
                <button onclick="deletePeserta(${p.id})" class="text-slate-500 hover:text-red-500 hover:bg-red-900/30 p-2 rounded transition-colors"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
}

// --- SENSOR UI DRAWING ---
let isSidebarCollapsed = false;

function toggleSidebar() {
    isSidebarCollapsed = !isSidebarCollapsed;
    const catName = document.getElementById('draw-select-kategori').value;
    if (catName) renderVisualBracket(catName);
}

function highlightAthlete(id) {
    if (id == null || id === -1) return;
    document.querySelectorAll(`.athlete-match-${id}`).forEach(el => {
        el.classList.add('ring-4', 'ring-yellow-400', 'shadow-[0_0_20px_rgba(250,204,21,0.6)]', 'scale-[1.03]', 'z-40');
        el.style.borderColor = '#facc15';
    });
}

function removeHighlightAthlete(id) {
    if (id == null || id === -1) return;
    document.querySelectorAll(`.athlete-match-${id}`).forEach(el => {
        el.classList.remove('ring-4', 'ring-yellow-400', 'shadow-[0_0_20px_rgba(250,204,21,0.6)]', 'scale-[1.03]', 'z-40');
        el.style.borderColor = '';
    });
}

// FUNGSI UNTUK PINDAH HALAMAN
function changeAthletePage(delta) {
    currentAthletePage += delta;
    renderParticipantTable();
}

function deletePeserta(id) { if (confirm('Hapus atlet ini?')) { STATE.participants = STATE.participants.filter(p => p.id !== id); saveToLocalStorage(); renderParticipantTable(); } }
function openEditModal(id) { const p = STATE.participants.find(x => x.id === id); if (!p) return; document.getElementById('edit-id').value = p.id; document.getElementById('edit-nama').value = p.nama; document.getElementById('edit-kontingen').value = p.kontingen; document.getElementById('edit-kategori').value = p.kategori; document.getElementById('edit-modal').classList.remove('hidden'); }
function closeEditModal() { document.getElementById('edit-modal').classList.add('hidden'); }
document.getElementById('form-edit-peserta').addEventListener('submit', (e) => { e.preventDefault(); const id = parseInt(document.getElementById('edit-id').value); const newKategori = document.getElementById('edit-kategori').value; const idx = STATE.participants.findIndex(p => p.id === id); if (idx > -1) { if (STATE.participants[idx].kategori !== newKategori) { STATE.participants[idx].urut = 0; STATE.participants[idx].pool = '-'; STATE.participants[idx].isFinalist = false; STATE.participants[idx].losses = 0; STATE.participants[idx].scores = { b1: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 }, b2: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 } }; STATE.participants[idx].finalScore = 0; STATE.participants[idx].techScore = 0; } STATE.participants[idx].nama = document.getElementById('edit-nama').value; STATE.participants[idx].kontingen = document.getElementById('edit-kontingen').value; STATE.participants[idx].kategori = newKategori; saveToLocalStorage(); renderParticipantTable(); closeEditModal(); alert("Data diperbarui."); } });

// ==============================================================
// SISTEM TIMBANG BADAN (WEIGH-IN) & KEPUTUSAN TM
// ==============================================================

// Memori Range per Kategori
let TIMBANG_RANGES = {};

function extractWeightRange(catName) {
    if (TIMBANG_RANGES[catName]) return TIMBANG_RANGES[catName];

    let min = 0, max = 999;
    const txt = catName.toLowerCase();

    const rangeMatch = txt.match(/(\d+)\s*-\s*(\d+)/);
    const overMatch = txt.match(/[>+]\s*(\d+)|diatas\s*(\d+)/);
    const underMatch = txt.match(/[<-]\s*(\d+)|dibawah\s*(\d+)/);

    if (rangeMatch) { min = parseFloat(rangeMatch[1]); max = parseFloat(rangeMatch[2]); }
    else if (overMatch) { min = parseFloat(overMatch[1] || overMatch[2]); max = 999; }
    else if (underMatch) { min = 0; max = parseFloat(underMatch[1] || underMatch[2]); }

    TIMBANG_RANGES[catName] = { min, max };
    return { min, max };
}

function bukaModalEditRange() {
    const catName = document.getElementById('timbang-select-kategori').value;
    if (!catName) return;
    let range = extractWeightRange(catName);
    document.getElementById('input-range-min').value = range.min;
    document.getElementById('input-range-max').value = range.max === 999 ? '' : range.max;
    document.getElementById('modal-edit-range').classList.remove('hidden');
}

function simpanManualRange() {
    const catName = document.getElementById('timbang-select-kategori').value;
    let min = parseFloat(document.getElementById('input-range-min').value) || 0;
    let max = parseFloat(document.getElementById('input-range-max').value) || 999;
    TIMBANG_RANGES[catName] = { min, max };
    document.getElementById('modal-edit-range').classList.add('hidden');
    renderTimbangTable(); // Refresh tabel dengan aturan baru
}

// Injeksi otomatis pengisi dropdown Timbang (DENGAN PENGAMAN STATE)
const originalUpdateDropdownsTimbang = updateAllDropdowns;
updateAllDropdowns = function () {
    originalUpdateDropdownsTimbang();
    const elTimbang = document.getElementById('timbang-select-kategori');
    if (elTimbang) {
        let oldVal = elTimbang.value; // AMANKAN VALUE LAMA SEBELUM DI-REFRESH
        let randoriCats = STATE.categories.filter(c => c.discipline === 'randori');
        elTimbang.innerHTML = `<option value="">-- Pilih Kelas Randori --</option>` +
            randoriCats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
        if (oldVal) elTimbang.value = oldVal; // KEMBALIKAN VALUE LAMA
    }
}

function renderTimbangTable() {
    const searchInput = document.getElementById('timbang-search');
    const selectKategori = document.getElementById('timbang-select-kategori');

    // 👇 SUNTIKAN KECERDASAN: Auto-Global Pencarian 👇
    // Jika panitia mengetik 2 huruf atau lebih, paksa dropdown kembali ke "Semua Kelas"
    if (searchInput.value.trim().length >= 2 && selectKategori.value !== "") {
        selectKategori.value = "";
    }

    const catName = selectKategori.value;
    const searchTxt = searchInput.value.toLowerCase().trim();
    const tbody = document.getElementById('table-timbang-body');
    const rangeDisplay = document.getElementById('timbang-range-display');
    const lockBadge = document.getElementById('timbang-status-lock');

    // 1. Jika dropdown kosong DAN kotak pencarian kurang dari 2 huruf
    if (!catName && searchTxt.length < 2) {
        rangeDisplay.innerText = "-";
        lockBadge.classList.add('hidden');
        return tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-500">Pilih kelas Randori atau ketik minimal 2 huruf nama/kontingen di kolom pencarian.</td></tr>`;
    }

    // 2. Set UI Info Range Atas
    if (catName) {
        let range = extractWeightRange(catName);
        rangeDisplay.innerText = `${range.min} Kg - ${range.max === 999 ? 'Tak Terbatas' : range.max + ' Kg'}`;
        let isDrawn = STATE.matches.some(m => m.kategori === catName);
        if (isDrawn) lockBadge.classList.remove('hidden'); else lockBadge.classList.add('hidden');
    } else {
        rangeDisplay.innerText = "MODE PENCARIAN GLOBAL";
        lockBadge.classList.add('hidden');
    }

    // 3. Tarik Semua Atlet Randori yang Belum Dicoret
    let randoriCats = STATE.categories.filter(c => c.discipline === 'randori').map(c => c.name);
    let athletes = STATE.participants.filter(p => randoriCats.includes(p.kategori) && p.statusTimbang !== 'CORET');

    // Filter Kategori (Jika dipilih)
    if (catName) {
        athletes = athletes.filter(p => p.kategori === catName);
    }

    // Filter Pencarian Teks (Jika diketik minimal 2 huruf)
    if (searchTxt.length >= 2) {
        athletes = athletes.filter(p => p.nama.toLowerCase().includes(searchTxt) || p.kontingen.toLowerCase().includes(searchTxt));
    }

    if (athletes.length === 0) return tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-500">Tidak ada atlet ditemukan.</td></tr>`;

    // 4. Render Baris Tabel
    tbody.innerHTML = athletes.map(p => {
        // Tarik range spesifik untuk atlet ini (Sangat berguna saat pencarian global)
        let range = extractWeightRange(p.kategori);

        let b = p.beratBadan || '';
        let isLolos = (b !== '' && b >= range.min && b <= range.max);
        let isOver = (b !== '' && b > range.max);
        let isUnder = (b !== '' && b < range.min);

        let statusHtml = `<span class="bg-slate-800 text-slate-500 px-2 py-1 rounded text-[10px] font-bold">MENUNGGU</span>`;
        if (isLolos) statusHtml = `<span class="bg-green-900/40 text-green-400 border border-green-700 px-2 py-1 rounded text-[10px] font-black"><i class="fas fa-check mr-1"></i> LOLOS</span>`;
        else if (isOver) statusHtml = `<span class="bg-red-900/40 text-red-400 border border-red-700 px-2 py-1 rounded text-[10px] font-black animate-pulse">OVER</span>`;
        else if (isUnder) statusHtml = `<span class="bg-yellow-900/40 text-yellow-500 border border-yellow-700 px-2 py-1 rounded text-[10px] font-black animate-pulse">UNDER</span>`;

        // Deteksi individu apakah kategori atlet ini sudah di-drawing
        let isThisCatDrawn = STATE.matches.some(m => m.kategori === p.kategori);
        let actionHtml = `<span class="text-slate-600 text-xs italic">-</span>`;

        if (!isThisCatDrawn) {
            if (isOver || isUnder) {
                actionHtml = `
                    <button onclick="bukaModalPindahKelas(${p.id})" class="bg-orange-900/50 hover:bg-orange-600 text-orange-400 hover:text-white p-2 rounded transition-colors" title="Pindah Kelas">
                        <i class="fas fa-exchange-alt"></i>
                    </button>
                    <button onclick="coretAtletTM(${p.id})" class="bg-red-900/50 hover:bg-red-600 text-red-400 hover:text-white p-2 rounded transition-colors ml-1" title="Coret / Diskualifikasi">
                        <i class="fas fa-user-slash"></i>
                    </button>
                `;
            }
        } else {
            actionHtml = `<i class="fas fa-lock text-slate-600" title="Terkunci. Bagan sudah dibuat."></i>`;
        }

        return `
        <tr class="border-b border-slate-800 hover:bg-slate-800/30">
            <td class="p-4">
                <div class="font-bold text-white">${p.nama}</div>
                <!-- INFO KELAS DAN TARGET BERAT MUNCUL DI SINI -->
                <div class="text-[10px] text-teal-400 font-bold mt-1 uppercase tracking-wider">${p.kategori} (${range.min} - ${range.max === 999 ? 'MAX' : range.max} Kg)</div>
            </td>
            <td class="p-4 text-xs text-slate-400 uppercase">${p.kontingen}</td>
            <td class="p-4 text-center">
                <div class="flex items-center justify-center gap-2">
                    <input type="number" step="0.1" id="input-berat-${p.id}" value="${b}" ${isThisCatDrawn ? 'disabled' : ''} class="w-16 bg-slate-900 border ${b !== '' ? (isLolos ? 'border-green-500' : 'border-red-500') : 'border-slate-600'} rounded p-1.5 text-white text-center text-sm font-bold outline-none">
                    ${!isThisCatDrawn ? `<button onclick="simpanBerat(${p.id})" class="text-teal-400 hover:text-teal-300 p-1"><i class="fas fa-save"></i></button>` : ''}
                </div>
            </td>
            <td class="p-4 text-center">${statusHtml}</td>
            <td class="p-4 text-center whitespace-nowrap">${actionHtml}</td>
        </tr>`;
    }).join('');
}

// =========================================================================
// 1. FUNGSI SIMPAN BERAT (SUPER OPTIMIZED: 0 READ JIKA ADA ID FIRESTORE)
// =========================================================================
async function simpanBerat(id) {
    let p = STATE.participants.find(x => x.id === id);
    if (!p) return;
    
    let val = document.getElementById(`input-berat-${id}`).value;
    p.beratBadan = val === '' ? '' : parseFloat(val);
    
    // 1. Simpan ke Memori Browser & RTDB Turnamen
    saveToLocalStorage();

    // 2. Sinkronisasi ke Firestore Dokumen Pendaftaran
    if (firestoreDB) {
        try {
            let btn = document.querySelector(`button[onclick="simpanBerat(${id})"]`);
            if (btn) {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin text-teal-400"></i>';
                btn.disabled = true;
            }

            // Jalur Cepat (0 Read): Langsung tembak ID Dokumen
            if (p.idFirestore) {
                await firestoreDB.collection('pendaftaran_t2').doc(p.idFirestore).update({
                    beratBadan: p.beratBadan
                });
            } else {
                // Jalur Cadangan (1 Read): Cari by Nama jika idFirestore kosong
                const snapshot = await firestoreDB.collection('pendaftaran_t2')
                    .where('nama', '==', p.nama)
                    .limit(1)
                    .get();

                if (!snapshot.empty) {
                    p.idFirestore = snapshot.docs[0].id; // Simpan ID agar klik berikutnya 0 Read
                    await firestoreDB.collection('pendaftaran_t2').doc(p.idFirestore).update({
                        beratBadan: p.beratBadan
                    });
                }
            }

            if (btn) {
                btn.innerHTML = '<i class="fas fa-check text-green-400"></i>';
                setTimeout(() => { renderTimbangTable(); }, 500);
                return;
            }
        } catch (error) {
            console.error("Gagal simpan berat ke Firestore:", error);
            alert("Gagal sinkronisasi berat badan ke Firestore.");
        }
    }
    
    renderTimbangTable();
}

// =========================================================================
// 2. FUNGSI CORET ATLET (SUPER OPTIMIZED: 0 READ JIKA ADA ID FIRESTORE)
// =========================================================================
async function coretAtletTM(id) {
    let p = STATE.participants.find(x => x.id === id);
    if (!p) return;

    if (confirm(`Keputusan TM Mutlak:\nApakah Anda yakin ingin MENCORET/MENDISKUALIFIKASI atlet ${p.nama}?\n\n(Atlet tidak akan dimasukkan ke dalam bagan pertandingan)`)) {
        
        p.statusTimbang = 'CORET';
        saveToLocalStorage();

        if (firestoreDB) {
            try {
                document.body.style.cursor = 'wait';

                if (p.idFirestore) {
                    await firestoreDB.collection('pendaftaran_t2').doc(p.idFirestore).update({
                        statusTimbang: 'CORET'
                    });
                } else {
                    const snapshot = await firestoreDB.collection('pendaftaran_t2')
                        .where('nama', '==', p.nama)
                        .limit(1)
                        .get();

                    if (!snapshot.empty) {
                        p.idFirestore = snapshot.docs[0].id;
                        await firestoreDB.collection('pendaftaran_t2').doc(p.idFirestore).update({
                            statusTimbang: 'CORET'
                        });
                    }
                }
                document.body.style.cursor = 'default';
            } catch (e) {
                document.body.style.cursor = 'default';
                console.error("Gagal update status coret di Firestore:", e);
            }
        }
        
        renderTimbangTable();
    }
}

function bukaModalPindahKelas(id) {
    let p = STATE.participants.find(x => x.id === id);
    if (!p) return;

    document.getElementById('pindah-atlet-id').value = id;
    document.getElementById('teks-pindah-info').innerHTML = `Atlet: <b>${p.nama}</b><br>Berat Aktual: <b>${p.beratBadan} Kg</b>`;

    let randoriCats = STATE.categories.filter(c => c.discipline === 'randori' && c.name !== p.kategori);
    let selectEl = document.getElementById('pindah-select-kategori');

    selectEl.innerHTML = randoriCats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    document.getElementById('modal-pindah-kelas').classList.remove('hidden');
}

// =========================================================================
// 3. FUNGSI PINDAH KELAS (TARGET FIELD: 'kelas' PADA FIRESTORE)
// =========================================================================
async function eksekusiPindahKelas() {
    let id = parseInt(document.getElementById('pindah-atlet-id').value);
    let targetKategori = document.getElementById('pindah-select-kategori').value;

    let p = STATE.participants.find(x => x.id === id);
    if (!p || !targetKategori) return;

    if (confirm(`Pindahkan ${p.nama} ke kelas ${targetKategori}?`)) {
        // 1. Update State Memori Lokal & RTDB Turnamen
        p.kategori = targetKategori;
        p.urut = 0; 
        p.pool = '-';
        saveToLocalStorage();

        // 2. Update Field Asli 'kelas' di Firestore (pendaftaran_t2)
        if (firestoreDB) {
            try {
                const btn = document.querySelector('#modal-pindah-kelas button.bg-orange-600');
                if (btn) { 
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Menyimpan...'; 
                    btn.disabled = true; 
                }

                // Data update: ganti field 'kelas' & hapus field duplikat 'kategori' jika ada
                const updatePayload = {
                    kelas: targetKategori
                };

                // Bersihkan field 'kategori' agar dokumen Firestore tetap rapi
                if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) {
                    updatePayload.kategori = firebase.firestore.FieldValue.delete();
                }

                if (p.idFirestore) {
                    // Jalur Cepat (0 Read): Langsung ke ID Dokumen
                    await firestoreDB.collection('pendaftaran_t2').doc(p.idFirestore).update(updatePayload);
                } else {
                    // Jalur Cadangan: Cari berdasarkan array atlet atau field nama
                    let snapshot = await firestoreDB.collection('pendaftaran_t2')
                        .where('atlet', 'array-contains', p.nama)
                        .limit(1)
                        .get();

                    if (snapshot.empty) {
                        snapshot = await firestoreDB.collection('pendaftaran_t2')
                            .where('nama', '==', p.nama)
                            .limit(1)
                            .get();
                    }

                    if (!snapshot.empty) {
                        p.idFirestore = snapshot.docs[0].id;
                        await firestoreDB.collection('pendaftaran_t2').doc(p.idFirestore).update(updatePayload);
                    }
                }
                
                if (btn) { 
                    btn.innerHTML = 'Pindahkan Sekarang'; 
                    btn.disabled = false; 
                }
            } catch (e) {
                console.error("Gagal sinkronisasi pindah kelas ke Firestore:", e);
            }
        }

        document.getElementById('modal-pindah-kelas').classList.add('hidden');
        renderTimbangTable();
        alert(`Atlet ${p.nama} berhasil dipindahkan ke kelas ${targetKategori}!`);
    }
}

const TEMPLATE_4_STANDARD = [
    { matchNum: 1, babak: "Semi-Final", col: 1, slot1: 1, slot2: 2, nextW: 3, nextWSlot: 1, nextL: 4, nextLSlot: 1 },
    { matchNum: 2, babak: "Semi-Final", col: 1, slot1: 3, slot2: 4, nextW: 3, nextWSlot: 2, nextL: 4, nextLSlot: 2 },
    { matchNum: 3, babak: "FINAL ATAS", col: 2, slot1: null, slot2: null, nextW: 6, nextWSlot: 1, nextL: 5, nextLSlot: 1 },
    { matchNum: 4, babak: "LB S-Final", col: 2, slot1: null, slot2: null, nextW: 5, nextWSlot: 2, nextL: null },
    { matchNum: 5, babak: "FINAL BAWAH", col: 3, slot1: null, slot2: null, nextW: 6, nextWSlot: 2, nextL: null },
    { matchNum: 6, babak: "GRAND FINAL", col: 4, slot1: null, slot2: null, nextW: 'WINNER', nextL: 'SECOND' }
];
const TEMPLATE_4_CROSS = [
    { matchNum: 1, babak: "S-Final Crossover", col: 1, slot1: 1, slot2: 4, nextW: 3, nextWSlot: 1, nextL: 4, nextLSlot: 1 },
    { matchNum: 2, babak: "S-Final Crossover", col: 1, slot1: 3, slot2: 2, nextW: 3, nextWSlot: 2, nextL: 4, nextLSlot: 2 },
    { matchNum: 3, babak: "FINAL ATAS", col: 2, slot1: null, slot2: null, nextW: 6, nextWSlot: 1, nextL: 5, nextLSlot: 2 },
    { matchNum: 4, babak: "LB R1", col: 2, slot1: null, slot2: null, nextW: 5, nextWSlot: 1, nextL: null },
    { matchNum: 5, babak: "FINAL BAWAH", col: 3, slot1: null, slot2: null, nextW: 6, nextWSlot: 2, nextL: null },
    { matchNum: 6, babak: "GRAND FINAL", col: 4, slot1: null, slot2: null, nextW: 'WINNER', nextL: 'SECOND' }
];
const TEMPLATE_8_PERKEMI = [
    { matchNum: 1, babak: "Penyisihan 1", col: 1, slot1: 1, slot2: 2, nextW: 7, nextWSlot: 1, nextL: 5, nextLSlot: 1 },
    { matchNum: 2, babak: "Penyisihan 2", col: 1, slot1: 3, slot2: 4, nextW: 7, nextWSlot: 2, nextL: 5, nextLSlot: 2 },
    { matchNum: 3, babak: "Penyisihan 3", col: 1, slot1: 5, slot2: 6, nextW: 8, nextWSlot: 1, nextL: 6, nextLSlot: 1 },
    { matchNum: 4, babak: "Penyisihan 4", col: 1, slot1: 7, slot2: 8, nextW: 8, nextWSlot: 2, nextL: 6, nextLSlot: 2 },
    { matchNum: 7, babak: "Semi-Final W", col: 2, slot1: null, slot2: null, nextW: 11, nextWSlot: 1, nextL: 10, nextLSlot: 1 },
    { matchNum: 8, babak: "Semi-Final W", col: 2, slot1: null, slot2: null, nextW: 11, nextWSlot: 2, nextL: 9, nextLSlot: 1 },
    { matchNum: 11, babak: "FINAL ATAS", col: 3, slot1: null, slot2: null, nextW: 14, nextWSlot: 1, nextL: 13, nextLSlot: 1 }, // <-- nextLSlot diubah jadi 1 (Pita Merah) 
    { matchNum: 5, babak: "LB R1", col: 1, slot1: null, slot2: null, nextW: 9, nextWSlot: 2, nextL: null },
    { matchNum: 6, babak: "LB R1", col: 1, slot1: null, slot2: null, nextW: 10, nextWSlot: 2, nextL: null },
    { matchNum: 9, babak: "LB R2", col: 2, slot1: null, slot2: null, nextW: 12, nextWSlot: 1, nextL: null },
    { matchNum: 10, babak: "LB R2", col: 2, slot1: null, slot2: null, nextW: 12, nextWSlot: 2, nextL: null },
    { matchNum: 12, babak: "LB S-FINAL", col: 3, slot1: null, slot2: null, nextW: 13, nextWSlot: 2, nextL: null }, // <-- nextWSlot diubah jadi 2 (Pita Putih)
    { matchNum: 13, babak: "FINAL BAWAH", col: 4, slot1: null, slot2: null, nextW: 14, nextWSlot: 2, nextL: null },
    { matchNum: 14, babak: "GRAND FINAL", col: 5, slot1: null, slot2: null, nextW: 'WINNER', nextL: 'SECOND' }
];
const TEMPLATE_16 = [
    { matchNum: 1, babak: "WB R1", col: 1, slot1: 1, slot2: 2, nextW: 9, nextWSlot: 1, nextL: 13, nextLSlot: 1 },
    { matchNum: 2, babak: "WB R1", col: 1, slot1: 3, slot2: 4, nextW: 9, nextWSlot: 2, nextL: 13, nextLSlot: 2 },
    { matchNum: 3, babak: "WB R1", col: 1, slot1: 5, slot2: 6, nextW: 10, nextWSlot: 1, nextL: 14, nextLSlot: 1 },
    { matchNum: 4, babak: "WB R1", col: 1, slot1: 7, slot2: 8, nextW: 10, nextWSlot: 2, nextL: 14, nextLSlot: 2 },
    { matchNum: 5, babak: "WB R1", col: 1, slot1: 9, slot2: 10, nextW: 11, nextWSlot: 1, nextL: 15, nextLSlot: 1 },
    { matchNum: 6, babak: "WB R1", col: 1, slot1: 11, slot2: 12, nextW: 11, nextWSlot: 2, nextL: 15, nextLSlot: 2 },
    { matchNum: 7, babak: "WB R1", col: 1, slot1: 13, slot2: 14, nextW: 12, nextWSlot: 1, nextL: 16, nextLSlot: 1 },
    { matchNum: 8, babak: "WB R1", col: 1, slot1: 15, slot2: 16, nextW: 12, nextWSlot: 2, nextL: 16, nextLSlot: 2 },
    { matchNum: 9, babak: "WB QF", col: 2, slot1: null, slot2: null, nextW: 21, nextWSlot: 1, nextL: 20, nextLSlot: 1 },
    { matchNum: 10, babak: "WB QF", col: 2, slot1: null, slot2: null, nextW: 21, nextWSlot: 2, nextL: 19, nextLSlot: 1 },
    { matchNum: 11, babak: "WB QF", col: 2, slot1: null, slot2: null, nextW: 22, nextWSlot: 1, nextL: 18, nextLSlot: 1 },
    { matchNum: 12, babak: "WB QF", col: 2, slot1: null, slot2: null, nextW: 22, nextWSlot: 2, nextL: 17, nextLSlot: 1 },
    { matchNum: 13, babak: "LB R1", col: 2, slot1: null, slot2: null, nextW: 17, nextWSlot: 2, nextL: null },
    { matchNum: 14, babak: "LB R1", col: 2, slot1: null, slot2: null, nextW: 18, nextWSlot: 2, nextL: null },
    { matchNum: 15, babak: "LB R1", col: 2, slot1: null, slot2: null, nextW: 19, nextWSlot: 2, nextL: null },
    { matchNum: 16, babak: "LB R1", col: 2, slot1: null, slot2: null, nextW: 20, nextWSlot: 2, nextL: null },
    { matchNum: 17, babak: "LB R2", col: 3, slot1: null, slot2: null, nextW: 23, nextWSlot: 1, nextL: null },
    { matchNum: 18, babak: "LB R2", col: 3, slot1: null, slot2: null, nextW: 23, nextWSlot: 2, nextL: null },
    { matchNum: 19, babak: "LB R2", col: 3, slot1: null, slot2: null, nextW: 24, nextWSlot: 1, nextL: null },
    { matchNum: 20, babak: "LB R2", col: 3, slot1: null, slot2: null, nextW: 24, nextWSlot: 2, nextL: null },
    { matchNum: 21, babak: "WB SF", col: 4, slot1: null, slot2: null, nextW: 27, nextWSlot: 1, nextL: 26, nextLSlot: 1 },
    { matchNum: 22, babak: "WB SF", col: 4, slot1: null, slot2: null, nextW: 27, nextWSlot: 2, nextL: 25, nextLSlot: 1 },
    { matchNum: 23, babak: "LB R3", col: 4, slot1: null, slot2: null, nextW: 25, nextWSlot: 2, nextL: null },
    { matchNum: 24, babak: "LB R3", col: 4, slot1: null, slot2: null, nextW: 26, nextWSlot: 2, nextL: null },
    { matchNum: 25, babak: "LB QF", col: 5, slot1: null, slot2: null, nextW: 28, nextWSlot: 1, nextL: null },
    { matchNum: 26, babak: "LB QF", col: 5, slot1: null, slot2: null, nextW: 28, nextWSlot: 2, nextL: null },
    { matchNum: 27, babak: "FINAL ATAS", col: 6, slot1: null, slot2: null, nextW: 30, nextWSlot: 1, nextL: 29, nextLSlot: 1 },
    { matchNum: 28, babak: "LB SF", col: 6, slot1: null, slot2: null, nextW: 29, nextWSlot: 2, nextL: null },
    { matchNum: 29, babak: "FINAL BAWAH", col: 7, slot1: null, slot2: null, nextW: 30, nextWSlot: 2, nextL: null },
    { matchNum: 30, babak: "GRAND FINAL", col: 8, slot1: null, slot2: null, nextW: 'WINNER', nextL: 'SECOND' }
];
// --- TEMPLATE SINGLE ELIMINATION (SISTEM GUGUR BIASA) ---
const SINGLE_TEMPLATE_4 = [
    { matchNum: 1, babak: "Semi-Final", col: 1, slot1: 1, slot2: 2, nextW: 3, nextWSlot: 1, nextL: null, nextLSlot: null },
    { matchNum: 2, babak: "Semi-Final", col: 1, slot1: 3, slot2: 4, nextW: 3, nextWSlot: 2, nextL: null, nextLSlot: null },
    { matchNum: 3, babak: "FINAL", col: 2, slot1: null, slot2: null, nextW: 'WINNER', nextL: 'SECOND' }
];
const SINGLE_TEMPLATE_4_CROSS = [
    { matchNum: 1, babak: "S-Final Crossover", col: 1, slot1: 1, slot2: 4, nextW: 3, nextWSlot: 1, nextL: null, nextLSlot: null },
    { matchNum: 2, babak: "S-Final Crossover", col: 1, slot1: 3, slot2: 2, nextW: 3, nextWSlot: 2, nextL: null, nextLSlot: null },
    { matchNum: 3, babak: "GRAND FINAL", col: 2, slot1: null, slot2: null, nextW: 'WINNER', nextL: 'SECOND' }
];
const SINGLE_TEMPLATE_8 = [
    { matchNum: 1, babak: "Quarter-Final", col: 1, slot1: 1, slot2: 2, nextW: 5, nextWSlot: 1, nextL: null, nextLSlot: null },
    { matchNum: 2, babak: "Quarter-Final", col: 1, slot1: 3, slot2: 4, nextW: 5, nextWSlot: 2, nextL: null, nextLSlot: null },
    { matchNum: 3, babak: "Quarter-Final", col: 1, slot1: 5, slot2: 6, nextW: 6, nextWSlot: 1, nextL: null, nextLSlot: null },
    { matchNum: 4, babak: "Quarter-Final", col: 1, slot1: 7, slot2: 8, nextW: 6, nextWSlot: 2, nextL: null, nextLSlot: null },
    { matchNum: 5, babak: "Semi-Final", col: 2, slot1: null, slot2: null, nextW: 7, nextWSlot: 1, nextL: null, nextLSlot: null },
    { matchNum: 6, babak: "Semi-Final", col: 2, slot1: null, slot2: null, nextW: 7, nextWSlot: 2, nextL: null, nextLSlot: null },
    { matchNum: 7, babak: "FINAL", col: 3, slot1: null, slot2: null, nextW: 'WINNER', nextL: 'SECOND' }
];
const SINGLE_TEMPLATE_16 = [
    { matchNum: 1, babak: "Babak 16", col: 1, slot1: 1, slot2: 2, nextW: 9, nextWSlot: 1, nextL: null, nextLSlot: null },
    { matchNum: 2, babak: "Babak 16", col: 1, slot1: 3, slot2: 4, nextW: 9, nextWSlot: 2, nextL: null, nextLSlot: null },
    { matchNum: 3, babak: "Babak 16", col: 1, slot1: 5, slot2: 6, nextW: 10, nextWSlot: 1, nextL: null, nextLSlot: null },
    { matchNum: 4, babak: "Babak 16", col: 1, slot1: 7, slot2: 8, nextW: 10, nextWSlot: 2, nextL: null, nextLSlot: null },
    { matchNum: 5, babak: "Babak 16", col: 1, slot1: 9, slot2: 10, nextW: 11, nextWSlot: 1, nextL: null, nextLSlot: null },
    { matchNum: 6, babak: "Babak 16", col: 1, slot1: 11, slot2: 12, nextW: 11, nextWSlot: 2, nextL: null, nextLSlot: null },
    { matchNum: 7, babak: "Babak 16", col: 1, slot1: 13, slot2: 14, nextW: 12, nextWSlot: 1, nextL: null, nextLSlot: null },
    { matchNum: 8, babak: "Babak 16", col: 1, slot1: 15, slot2: 16, nextW: 12, nextWSlot: 2, nextL: null, nextLSlot: null },
    { matchNum: 9, babak: "Quarter-Final", col: 2, slot1: null, slot2: null, nextW: 13, nextWSlot: 1, nextL: null, nextLSlot: null },
    { matchNum: 10, babak: "Quarter-Final", col: 2, slot1: null, slot2: null, nextW: 13, nextWSlot: 2, nextL: null, nextLSlot: null },
    { matchNum: 11, babak: "Quarter-Final", col: 2, slot1: null, slot2: null, nextW: 14, nextWSlot: 1, nextL: null, nextLSlot: null },
    { matchNum: 12, babak: "Quarter-Final", col: 2, slot1: null, slot2: null, nextW: 14, nextWSlot: 2, nextL: null, nextLSlot: null },
    { matchNum: 13, babak: "Semi-Final", col: 3, slot1: null, slot2: null, nextW: 15, nextWSlot: 1, nextL: null, nextLSlot: null },
    { matchNum: 14, babak: "Semi-Final", col: 3, slot1: null, slot2: null, nextW: 15, nextWSlot: 2, nextL: null, nextLSlot: null },
    { matchNum: 15, babak: "FINAL", col: 4, slot1: null, slot2: null, nextW: 'WINNER', nextL: 'SECOND' }
];

// ==========================================
// MESIN GENERATOR BAGAN RANDORI (DENGAN GATEKEEPER TIMBANG CERDAS)
// ==========================================
function generateRandoriBracket() {
    const catName = document.getElementById('draw-select-kategori').value;
    const categoryObj = STATE.categories.find(c => c.name === catName);
    if (!categoryObj) return alert("Pilih kategori terlebih dahulu!");

    let isEmbuH2H = categoryObj.discipline === 'embu' && STATE.settings && STATE.settings.embuFormat === 'h2h';
    if (categoryObj.discipline !== 'randori' && !isEmbuH2H) return alert("Pilih kategori Randori atau Embu (H2H) terlebih dahulu!");

    // FILTER MUTLAK: Jangan masukkan atlet yang sudah dicoret saat TM
    let athletes = STATE.participants.filter(p => p.kategori === catName && p.statusTimbang !== 'CORET');

    if (athletes.length === 0) return alert("Belum ada peserta di kategori ini (Atau semua peserta telah dicoret)!");

    // 👇 PENGAMAN: Bypass cek timbang jika ini adalah kelas Embu H2H 👇
    if (categoryObj.discipline === 'randori') {
        let range = extractWeightRange(catName);

        // DETEKSI ATLET BERMASALAH (Belum Timbang ATAU Over/Under Weight)
        let pendingAthletes = athletes.filter(p => {
            let b = p.beratBadan;
            if (b === undefined || b === '' || b === null) return true; // Belum Timbang
            if (b < range.min || b > range.max) return true; // Over / Under Weight
            return false;
        });

        if (pendingAthletes.length > 0) {
            // Tampilkan Modal Peringatan
            document.getElementById('drawing-pending-count').innerText = pendingAthletes.length;

            const warningTextEl = document.querySelector('#modal-confirm-drawing p span.border-b');
            if (warningTextEl) {
                warningTextEl.innerText = "bermasalah pada syarat timbang (Kosong / Over / Under)";
            }

            document.getElementById('drawing-pending-list').innerHTML = pendingAthletes.map(p => {
                let b = p.beratBadan;
                let reason = "Belum Timbang";
                let reasonColor = "text-slate-400 bg-slate-800 border-slate-700";

                if (b !== undefined && b !== '' && b !== null) {
                    if (b > range.max) {
                        reason = `OVER (${b} Kg)`;
                        reasonColor = "text-red-400 bg-red-900/30 border-red-800";
                    } else if (b < range.min) {
                        reason = `UNDER (${b} Kg)`;
                        reasonColor = "text-yellow-500 bg-yellow-900/30 border-yellow-700";
                    }
                }

                return `
                <div class="mb-2 flex flex-col border-b border-slate-800/50 pb-2">
                    <div class="flex items-center justify-between mb-1">
                        <span class="font-bold text-white"><i class="fas fa-user text-slate-500 mr-2 text-[10px]"></i>${p.nama}</span>
                        <span class="text-[9px] uppercase font-bold text-slate-400 tracking-wider">${p.kontingen}</span>
                    </div>
                    <div class="text-[9px] font-black px-2 py-0.5 rounded border inline-block w-max ${reasonColor}">
                        <i class="fas fa-exclamation-circle mr-1"></i>${reason}
                    </div>
                </div>
                `;
            }).join('');

            document.getElementById('modal-confirm-drawing').classList.remove('hidden');
            return; // ⛔ Hentikan eksekusi di sini agar menunggu konfirmasi Panitia
        }
    }

    // ✅ Bebas hambatan (Semua Randori lolos timbang, ATAU ini adalah kelas Embu H2H)
    executeRandoriBracket();
}

function executeRandoriBracket() {
    // Tutup modal jika terbuka
    const modal = document.getElementById('modal-confirm-drawing');
    if (modal) modal.classList.add('hidden');

    const container = document.getElementById('randori-bracket-view');
    const wrapper = document.getElementById('randori-bracket-container');
    SWAP_SELECTION = null;

    try {
        const catName = document.getElementById('draw-select-kategori').value;
        const categoryObj = STATE.categories.find(c => c.name === catName);
        const isFinalCategory = catName.toUpperCase().includes('FINAL');

        // PENGAMAN KEDUA: Filter atlet yang dicoret lagi untuk memastikan
        let athletes = STATE.participants.filter(p => p.kategori === catName && p.statusTimbang !== 'CORET');
        if (isFinalCategory) athletes = athletes.sort((a, b) => a.id - b.id);

        const count = athletes.length;

        const existingMatches = STATE.matches.filter(m => m.kategori === catName);
        if (existingMatches.length > 0) {
            if (!confirm("Bagan sudah ada! Mengacak ulang akan menghapus semua data pertandingan dan BAGAN AKAN BERUBAH. Yakin?")) return;
            STATE.matches = STATE.matches.filter(m => m.kategori !== catName);
            STATE.participants.filter(p => p.kategori === catName).forEach(p => p.losses = 0);
        }

        let poolConfigs = [];
        let mode = (STATE.settings && STATE.settings.tournamentMode) ? STATE.settings.tournamentMode : 'double';
        let finalMode = (STATE.settings && STATE.settings.finalRandoriMode) ? STATE.settings.finalRandoriMode : 'single';

        if (count <= 4) {
            let temp4;
            if (isFinalCategory) {
                temp4 = finalMode === 'single' ? SINGLE_TEMPLATE_4_CROSS : TEMPLATE_4_CROSS;
            } else {
                temp4 = mode === 'single' ? SINGLE_TEMPLATE_4 : TEMPLATE_4_STANDARD;
            }
            poolConfigs.push({ name: '-', template: temp4, size: 4, athletes: athletes, isCrossover: isFinalCategory });
        } else if (count <= 8) {
            let temp8 = mode === 'single' ? SINGLE_TEMPLATE_8 : TEMPLATE_8_PERKEMI;
            poolConfigs.push({ name: '-', template: temp8, size: 8, athletes: athletes, isCrossover: false });
        } else if (count <= 32) {
            if (!confirm(`Terdapat ${count} peserta. Sistem akan memecah menjadi 2 Pool (A dan B). Lanjutkan?`)) return;
            let shuffledAthletes = [...athletes];

            if (!isFinalCategory) {
                for (let i = shuffledAthletes.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    let temp = shuffledAthletes[i]; shuffledAthletes[i] = shuffledAthletes[j]; shuffledAthletes[j] = temp;
                }
            }

            let mid = Math.ceil(count / 2);
            let poolA = shuffledAthletes.slice(0, mid);
            let poolB = shuffledAthletes.slice(mid);

            poolA.forEach(a => { const p = STATE.participants.find(x => x.id === a.id); if (p) p.pool = 'A'; });
            poolB.forEach(a => { const p = STATE.participants.find(x => x.id === a.id); if (p) p.pool = 'B'; });

            let sizeA = poolA.length <= 4 ? 4 : (poolA.length <= 8 ? 8 : 16);
            let tempA = mode === 'single' ? (sizeA === 4 ? SINGLE_TEMPLATE_4 : (sizeA === 8 ? SINGLE_TEMPLATE_8 : SINGLE_TEMPLATE_16)) : (sizeA === 4 ? TEMPLATE_4_STANDARD : (sizeA === 8 ? TEMPLATE_8_PERKEMI : TEMPLATE_16));
            poolConfigs.push({ name: 'A', template: tempA, size: sizeA, athletes: poolA, isCrossover: false });

            let sizeB = poolB.length <= 4 ? 4 : (poolB.length <= 8 ? 8 : 16);
            let tempB = mode === 'single' ? (sizeB === 4 ? SINGLE_TEMPLATE_4 : (sizeB === 8 ? SINGLE_TEMPLATE_8 : SINGLE_TEMPLATE_16)) : (sizeB === 4 ? TEMPLATE_4_STANDARD : (sizeB === 8 ? TEMPLATE_8_PERKEMI : TEMPLATE_16));
            poolConfigs.push({ name: 'B', template: tempB, size: sizeB, athletes: poolB, isCrossover: false });

        } else {
            return alert("Sistem saat ini mendukung maksimal 32 peserta per nomor.");
        }

        let globalMatchIdCounter = Date.now();

        poolConfigs.forEach((config) => {
            const slotsCount = config.size;
            const athleteCount = config.athletes.length;
            const byeCount = slotsCount - athleteCount;
            const totalMatchesR1 = slotsCount / 2;

            if (config.isCrossover && byeCount > 0 && athleteCount > 0) return alert("Template Crossover Final membutuhkan 4 peserta penuh (tanpa BYE).");

            let finalSlots = new Array(slotsCount).fill(null);

            if (athleteCount > 0) {
                const shuffledAthletes = [...config.athletes];

                if (!isFinalCategory) {
                    for (let i = shuffledAthletes.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        let temp = shuffledAthletes[i]; shuffledAthletes[i] = shuffledAthletes[j]; shuffledAthletes[j] = temp;
                    }
                }

                if (byeCount === 0) {
                    shuffledAthletes.forEach((p, idx) => finalSlots[idx] = p.id);
                } else {
                    let athleteIds = shuffledAthletes.map(a => a.id);
                    let oddSlots = [], evenSlots = [];
                    for (let i = 1; i <= slotsCount; i++) { if (i % 2 !== 0) oddSlots.push(i); else evenSlots.push(i); }
                    if (byeCount > totalMatchesR1) return alert("Kesalahan Fatal: Jumlah BYE melebihi jumlah partai Babak 1.");

                    let evenSlotsDistributed = [];
                    const matchesPerQuarter = totalMatchesR1 / 4;

                    if (matchesPerQuarter >= 1) {
                        const quartersEvenRaw = [
                            evenSlots.slice(0, matchesPerQuarter),
                            evenSlots.slice(matchesPerQuarter, matchesPerQuarter * 2),
                            evenSlots.slice(matchesPerQuarter * 2, matchesPerQuarter * 3),
                            evenSlots.slice(matchesPerQuarter * 3)
                        ];
                        for (let i = 0; i < matchesPerQuarter; i++) {
                            [0, 2, 1, 3].forEach(qIdx => { evenSlotsDistributed.push(quartersEvenRaw[qIdx][i]); });
                        }
                    } else {
                        evenSlotsDistributed = [...evenSlots];
                    }

                    for (let b = 0; b < byeCount; b++) { finalSlots[evenSlotsDistributed[b] - 1] = -1; }
                    for (let o = 0; o < totalMatchesR1; o++) { finalSlots[oddSlots[o] - 1] = athleteIds.shift(); }
                    const unfilledEvenIndices = evenSlotsDistributed.slice(byeCount).map(s => s - 1);
                    unfilledEvenIndices.forEach(idx => { finalSlots[idx] = athleteIds.shift(); });
                }
            }

            config.template.forEach(t => {
                let mrhId = null;
                let pthId = null;

                if (config.isCrossover && athleteCount === 0) {
                    mrhId = null; pthId = null;
                } else {
                    mrhId = t.slot1 !== null ? finalSlots[t.slot1 - 1] : null;
                    pthId = t.slot2 !== null ? finalSlots[t.slot2 - 1] : null;
                }

                let match = {
                    id: globalMatchIdCounter++,
                    kategori: catName,
                    pool: config.name,
                    matchNum: t.matchNum,
                    babak: t.babak,
                    col: t.col,
                    nextW: t.nextW,
                    nextWSlot: t.nextWSlot || null,
                    nextL: t.nextL,
                    nextLSlot: t.nextLSlot || null,
                    merahId: mrhId,
                    putihId: pthId,
                    winnerId: null, loserId: null, status: 'pending', skorMerah: 0, skorPutih: 0
                };
                STATE.matches.push(match);
            });
        });

        processAutoWins(catName);
        saveToLocalStorage();
        renderVisualBracket(catName);
        setTimeout(() => alert(`Bagan berhasil di-generate!`), 300);
    } catch (err) { console.error(err); }
}

function resetNilaiKategoriLokal() {
    const catName = document.getElementById('draw-select-kategori').value;
    if (!catName) return alert("Pilih kategori terlebih dahulu.");
    const categoryObj = STATE.categories.find(c => c.name === catName);
    if (!categoryObj) return;

    if (!confirm(`⚠️ PERHATIAN!\nAnda akan MENGHAPUS SEMUA HASIL NILAI di kategori "${catName}".\n\nBagan atau Urutan Tampil TIDAK AKAN BERUBAH.\n\nApakah Anda yakin ingin mengosongkan nilai?`)) return;

    if (categoryObj.discipline === 'randori') {
        STATE.matches = STATE.matches.filter(m => !(m.kategori === catName && m.babak === "SUDDEN DEATH"));
        let catMatches = STATE.matches.filter(m => m.kategori === catName);
        catMatches.forEach(m => {
            if (m.col > 1) { m.merahId = null; m.putihId = null; }
            m.status = 'pending'; m.winnerId = null; m.loserId = null; m.skorMerah = 0; m.skorPutih = 0;
        });
        STATE.participants.filter(p => p.kategori === catName).forEach(p => p.losses = 0);
        processAutoWins(catName);
    } else {
        STATE.participants.filter(p => p.kategori === catName).forEach(p => {
            p.scores = { b1: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 }, b2: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 } };
            p.finalScore = 0; p.techScore = 0;
        });
    }

    saveToLocalStorage();
    checkExistingDrawing();
    alert('Data nilai berhasil dikosongkan. Susunan bagan/urutan tetap aman!');
}

function handleSwap(matchId, corner, participantId, event) {
    if (event) event.stopPropagation();
    let match = STATE.matches.find(m => m.id === matchId);
    if (!match) return;
    let hasStarted = STATE.matches.some(x => x.kategori === match.kategori && x.status === 'done');
    if (hasStarted) return alert("❌ PERINGATAN DIRECTOR:\nTidak bisa menukar posisi! Turnamen di kategori ini sudah berjalan.\n\nKosongkan seluruh nilai jika Anda harus menukar posisi.");
    if (!SWAP_SELECTION) {
        SWAP_SELECTION = { matchId, corner, participantId };
        renderVisualBracket(match.kategori);
    } else {
        if (SWAP_SELECTION.matchId === matchId && SWAP_SELECTION.corner === corner) {
            SWAP_SELECTION = null;
            renderVisualBracket(match.kategori);
            return;
        }
        let matchA = STATE.matches.find(m => m.id === SWAP_SELECTION.matchId);
        let matchB = match;
        let tempId = matchA[SWAP_SELECTION.corner + 'Id'];
        matchA[SWAP_SELECTION.corner + 'Id'] = matchB[corner + 'Id'];
        matchB[corner + 'Id'] = tempId;

        SWAP_SELECTION = null;
        recalculateBracket(match.kategori);
    }
}

function recalculateBracket(catName) {
    let catMatches = STATE.matches.filter(m => m.kategori === catName);
    catMatches.forEach(m => {
        if (m.col > 1) { m.merahId = null; m.putihId = null; }
        m.status = 'pending'; m.winnerId = null; m.loserId = null; m.skorMerah = 0; m.skorPutih = 0;
    });
    processAutoWins(catName);
    saveToLocalStorage();
    renderVisualBracket(catName);
}

function recalculateAllLosses(catName) {
    STATE.participants.filter(p => p.kategori === catName).forEach(p => p.losses = 0);
    STATE.matches.filter(m => m.kategori === catName && (m.status === 'done' || m.status === 'auto-win')).forEach(m => {
        let actualLoserId = m.loserId;
        if (actualLoserId === undefined || actualLoserId === null) {
            if (m.winnerId !== null) {
                if (m.winnerId === m.merahId) actualLoserId = m.putihId;
                else if (m.winnerId === m.putihId) actualLoserId = m.merahId;
            }
        }
        if (actualLoserId && actualLoserId !== -1) {
            let loserP = STATE.participants.find(p => p.id === actualLoserId);
            if (loserP) loserP.losses += 1;
        }
    });
}

function undoMatchResult(matchId) {
    let match = STATE.matches.find(m => m.id === matchId);
    if (!match || match.status !== 'done') return;

    if (!confirm(`Batalkan hasil pertandingan G-${match.matchNum % 50 === 0 ? 50 : match.matchNum % 50}?`)) return;

    let nextWMatch = STATE.matches.find(m => m.kategori === match.kategori && m.matchNum === match.nextW && m.pool === match.pool);
    let nextLMatch = STATE.matches.find(m => m.kategori === match.kategori && m.matchNum === match.nextL && m.pool === match.pool);

    if (nextWMatch && nextWMatch.status !== 'pending' && nextWMatch.status !== 'auto-win') { 
        return alert("UNDO DITOLAK:\nPartai lanjutan dari pemenang sudah terlanjur dimainkan."); 
    }
    if (nextLMatch && nextLMatch.status !== 'pending' && nextLMatch.status !== 'auto-win') { 
        return alert("UNDO DITOLAK:\nPartai lanjutan dari yang kalah sudah terlanjur dimainkan."); 
    }

    // Bersihkan slot lanjutan
    if (nextWMatch) {
        if (nextWMatch.merahId === match.winnerId) nextWMatch.merahId = null;
        if (nextWMatch.putihId === match.winnerId) nextWMatch.putihId = null;
    }

    let loserId = match.loserId || (match.winnerId === match.merahId ? match.putihId : match.merahId);
    if (nextLMatch && loserId) {
        if (nextLMatch.merahId === loserId) nextLMatch.merahId = null;
        if (nextLMatch.putihId === loserId) nextLMatch.putihId = null;
    }

    // 🔥 PENCABUTAN SANKSI JIKA PARTAI INI ADALAH SUMBER PENJATUHAN BATSU
    [match.merahId, match.putihId].forEach(pId => {
        if (pId && pId !== -1) {
            let p = STATE.participants.find(x => x.id === pId);
            if (p && p.sanksiDetail && p.sanksiDetail.gameId === match.id) {
                p.statusSanksi = 'NORMAL';
                p.sanksiDetail = null;
            }
        }
    });

    if (match.nextW === 'WINNER') {
        STATE.matches = STATE.matches.filter(m => !(m.kategori === match.kategori && m.pool === match.pool && m.babak === "SUDDEN DEATH"));
    }

    match.status = 'pending'; 
    match.winnerId = null; 
    match.loserId = null; 
    match.skorMerah = 0; 
    match.skorPutih = 0;

    recalculateAllLosses(match.kategori);
    processAutoWins(match.kategori);
    saveToLocalStorage();

    let updates = {};
    updates['turnamen_data/matches'] = STATE.matches;
    updates['turnamen_data/participants'] = STATE.participants;

    if (database) {
        database.ref().update(updates).then(() => {
            renderVisualBracket(match.kategori); 
            filterPesertaScoring();
        }).catch(err => alert("Gagal Undo: " + err));
    } else {
        renderVisualBracket(match.kategori); 
        filterPesertaScoring();
    }
}

function forwardParticipant(targetMatchNum, participantId, catName, poolName, targetSlot = null) {
    if (!targetMatchNum || targetMatchNum === 'WINNER' || targetMatchNum === 'SECOND' || participantId == null) return;
    let targetMatch = STATE.matches.find(m => m.kategori === catName && m.matchNum === targetMatchNum && m.pool === poolName);
    if (targetMatch) {
        if (participantId !== -1 && (targetMatch.merahId === participantId || targetMatch.putihId === participantId)) return;

        // Memaksa atlet masuk ke Pita Merah (1) atau Putih (2)
        if (targetSlot === 1) targetMatch.merahId = participantId;
        else if (targetSlot === 2) targetMatch.putihId = participantId;
        else {
            if (targetMatch.merahId == null) targetMatch.merahId = participantId;
            else if (targetMatch.putihId == null) targetMatch.putihId = participantId;
        }
    }
}

function processAutoWins(catName) {
    let changed = true; let loopGuard = 0;
    while (changed && loopGuard < 100) {
        changed = false; loopGuard++;
        STATE.matches.filter(m => m.kategori === catName && m.status === 'pending').forEach(match => {
            if (match.merahId != null && match.putihId != null) {
                if (match.merahId === -1 || match.putihId === -1) {
                    match.status = 'auto-win';
                    if (match.merahId === -1 && match.putihId === -1) { match.winnerId = -1; match.loserId = -1; }
                    else { match.winnerId = match.merahId === -1 ? match.putihId : match.merahId; match.loserId = -1; }

                    forwardParticipant(match.nextW, match.winnerId, catName, match.pool, match.nextWSlot);
                    if (match.nextL) forwardParticipant(match.nextL, match.loserId, catName, match.pool, match.nextLSlot);
                    changed = true;
                }
            }
        });
    }
    recalculateAllLosses(catName);
}

function renderVisualBracket(catName) {
    const container = document.getElementById('randori-bracket-view');
    const oldWrapper = document.getElementById('randori-bracket-container');
    const newWrapper = document.getElementById('randori-layout-wrapper');
    const sidebar = document.getElementById('randori-sidebar');

    if (newWrapper) newWrapper.classList.remove('hidden');
    if (oldWrapper) oldWrapper.classList.remove('hidden');

    try {
        container.innerHTML = '';
        if (sidebar) sidebar.innerHTML = '';

        const catMatches = STATE.matches.filter(m => m.kategori === catName);
        if (catMatches.length === 0) return;

        const categoryObj = STATE.categories.find(c => c.name === catName);
        const isGroupEmbu = categoryObj && categoryObj.discipline === 'embu' && categoryObj.type > 1;

        let pools = []; catMatches.forEach(m => { if (pools.indexOf(m.pool) === -1) pools.push(m.pool); });
        pools.sort();

        const isSinglePool = pools.length === 1 && (pools[0] === '-' || pools[0] === 'SINGLE');
        const mode = (STATE.settings && STATE.settings.tournamentMode) ? STATE.settings.tournamentMode : 'double';
        let poolResults = calculateRandoriFinalists(catName) || [];

        // ==========================================
        // 1. RENDER PANEL KIRI (SIDEBAR SLOT MAP)
        // ==========================================
        if (sidebar) {
            if (isSidebarCollapsed) {
                // PERBAIKAN: Tambahkan 'overflow-hidden' dan set min-height agar teks panjang tidak menabrak batas bawah
                sidebar.className = "w-full lg:w-12 bg-dark-card border border-slate-700 rounded-2xl shadow-xl flex-shrink-0 lg:sticky top-20 flex flex-col transition-all duration-300 cursor-pointer hover:bg-slate-800 z-30 overflow-hidden min-h-[350px]";
                sidebar.innerHTML = `
                    <div onclick="toggleSidebar()" class="h-full w-full py-6 flex flex-col items-center justify-start text-slate-400" title="Buka Daftar Slot Atlet">
                        <i class="fas fa-expand-arrows-alt text-xl mb-8"></i>
                        <!-- PERBAIKAN: Gunakan writing-mode bawaan CSS agar bounding box presisi -->
                        <div class="[writing-mode:vertical-rl] transform rotate-180 font-bold tracking-widest uppercase whitespace-nowrap text-sm flex-1 text-center">DAFTAR ATLET</div>
                    </div>
                `;
            } else {
                sidebar.className = "w-full lg:w-1/3 xl:w-2/5 bg-dark-card border border-slate-700 rounded-2xl shadow-xl flex-shrink-0 lg:sticky top-20 flex flex-col transition-all duration-300 max-h-[85vh] z-30";

                let sidebarHTML = `
                    <div class="p-3 border-b border-slate-700 flex justify-between items-center bg-slate-800 rounded-t-2xl z-20 sticky top-0 shadow-sm">
                        <h3 class="font-black text-white text-sm"><i class="fas fa-list-ol text-blue-500 mr-2"></i>Peta Slot Undian</h3>
                        <button onclick="toggleSidebar()" class="text-slate-400 hover:text-white transition-colors bg-slate-700 hover:bg-slate-600 w-7 h-7 rounded flex items-center justify-center" title="Sembunyikan Daftar"><i class="fas fa-compress-arrows-alt"></i></button>
                    </div>
                    <div class="p-4 overflow-y-auto custom-scrollbar flex-1">
                `;

                let gridClass = isSinglePool ? "grid grid-cols-1 gap-6" : "grid grid-cols-1 lg:grid-cols-2 gap-4";
                sidebarHTML += `<div class="${gridClass}">`;

                pools.forEach(poolName => {
                    let poolResult = poolResults.find(r => r.pool === poolName);
                    let juara1 = poolResult ? poolResult.emas : null;

                    sidebarHTML += `<div class="flex flex-col gap-2">`;
                    if (!isSinglePool) {
                        sidebarHTML += `<h4 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-1 border-b border-slate-700 pb-1 text-center">POOL ${poolName}</h4>`;
                    }

                    let r1Matches = catMatches.filter(m => m.pool === poolName && m.col === 1 && !m.babak.toUpperCase().includes('LB')).sort((a, b) => a.matchNum - b.matchNum);

                    let slotCounter = 1;
                    r1Matches.forEach(m => {
                        sidebarHTML += generateSlotCard(slotCounter++, m.merahId, mode, juara1);
                        sidebarHTML += generateSlotCard(slotCounter++, m.putihId, mode, juara1);
                    });

                    sidebarHTML += `</div>`;
                });

                sidebarHTML += `</div>`;
                sidebarHTML += `
                    <div class="pt-3 mt-4 border-t border-slate-700">
                        <div class="flex flex-wrap gap-y-2 gap-x-4 text-[9px] text-slate-400 font-bold uppercase tracking-wider justify-center">
                            <div class="flex items-center gap-1.5"><div class="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.8)]"></div> Aktif</div>
                            <div class="flex items-center gap-1.5"><i class="fas fa-exclamation-triangle text-orange-500"></i> Loser Bracket</div>
                            <div class="flex items-center gap-1.5"><i class="fas fa-skull-crossbones text-red-500"></i> Gugur</div>
                            <div class="flex items-center gap-1.5"><i class="fas fa-crown text-yellow-500 text-[10px]"></i> Juara</div>
                        </div>
                    </div>
                </div>`;
                sidebar.innerHTML = sidebarHTML;
            }
        }

        // ==========================================
        // 2. RENDER PANEL KANAN (INFINITE HORIZONTAL CANVAS)
        // ==========================================
        let poolHTML = '<div class="flex flex-row items-start gap-12 p-2 w-full min-w-max">';

        pools.forEach((poolName, poolIndex) => {
            let poolMatches = catMatches.filter(m => m.pool === poolName);

            if (poolIndex > 0) {
                poolHTML += `
                <div class="flex flex-col items-center justify-stretch self-stretch w-1 bg-gradient-to-b from-red-600/50 via-slate-700 to-red-600/50 rounded-full mx-4 relative shrink-0">
                    <div class="absolute top-1/4 transform -translate-y-1/2 bg-slate-900 border border-red-500/40 text-[9px] font-black text-red-400 px-2 py-4 rounded-md tracking-widest uppercase [writing-mode:vertical-lr] shadow-lg">Batas Pool B ➡️</div>
                </div>`;
            }

            // PERBAIKAN: "w-full" Dihapus dan diganti menjadi "w-max" agar Pool A tidak meregang selayar penuh
            poolHTML += `
            <div class="flex flex-col shrink-0 relative w-max">
                <svg id="canvas-pool-${poolName}" class="absolute inset-0 w-full h-full pointer-events-none z-0"></svg>
                
                <div class="flex items-center gap-3 mb-6 border-b border-slate-700 pb-2 relative z-10 w-full">
                    <h3 class="text-xl font-black text-yellow-400 m-0 uppercase tracking-wider"><i class="fas fa-sitemap text-red-500 mr-2"></i>Bagan ${poolName !== '-' ? 'Pool ' + poolName : 'Utama'}</h3>
                    <span class="text-[10px] text-slate-500 font-mono ml-2 border-l border-slate-700 pl-3 hidden md:block">Swap: Klik Nama</span>
                    <button onclick="resetNilaiKategoriLokal()" class="ml-auto bg-red-900/50 border border-red-700 text-red-400 hover:bg-red-500 hover:text-white w-7 h-7 rounded flex items-center justify-center transition-colors" title="Kosongkan Nilai Saja">
                        <i class="fas fa-eraser text-xs"></i>
                    </button>
                </div>
                
                <div class="flex flex-col w-full relative z-10" id="bracket-grid-${poolName}">`;

            let columns = [];
            poolMatches.forEach(m => { if (columns.indexOf(m.col) === -1) columns.push(m.col); });
            columns.sort((a, b) => a - b);

            // PERBAIKAN: "w-full" diganti "w-max" pada baris ini juga
            let wbRowHTML = `<div class="flex flex-row gap-12 items-stretch w-max mb-8">`;
            let lbRowHTML = `<div class="flex flex-row gap-12 items-stretch w-max mt-8">`;
            let hasLoserBracket = false;

            columns.forEach(colNum => {
                let colMatches = poolMatches.filter(m => m.col === colNum).sort((a, b) => a.matchNum - b.matchNum);
                let wbMatches = colMatches.filter(m => !m.babak.toUpperCase().includes('LB') && !m.babak.toUpperCase().includes('BAWAH'));
                let lbMatches = colMatches.filter(m => m.babak.toUpperCase().includes('LB') || m.babak.toUpperCase().includes('BAWAH'));

                if (lbMatches.length > 0) hasLoserBracket = true;

                // Bangun Kolom WB (Lantai 1)
                wbRowHTML += `<div class="flex flex-col min-w-[260px] gap-6 justify-around relative">`;
                if (wbMatches.length > 0) {
                    wbRowHTML += `<h4 class="absolute -top-8 left-0 right-0 text-center text-[10px] font-black uppercase text-slate-500 tracking-widest">Babak ${colNum}</h4>`;
                }
                wbMatches.forEach(m => { wbRowHTML += generateMatchCardHTML(m, isGroupEmbu, poolName, poolMatches); });
                wbRowHTML += `</div>`;

                // Bangun Kolom LB (Lantai 2)
                lbRowHTML += `<div class="flex flex-col min-w-[260px] gap-6 justify-around relative">`;
                lbMatches.forEach(m => { lbRowHTML += generateMatchCardHTML(m, isGroupEmbu, poolName, poolMatches); });
                lbRowHTML += `</div>`;
            });

            wbRowHTML += `</div>`;
            lbRowHTML += `</div>`;

            poolHTML += wbRowHTML;

            // Garis Pemisah Loser Bracket
            if (hasLoserBracket) {
                poolHTML += `
                <div class="w-full flex items-center justify-center my-6 relative">
                    <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-dashed border-slate-700/80"></div></div>
                    <span class="bg-[#0f172a] px-4 text-[9px] font-black text-orange-500 uppercase tracking-widest relative z-10 border border-slate-700 rounded-full shadow-sm">JALUR LOSER BRACKET</span>
                </div>`;
                poolHTML += lbRowHTML;
            }

            poolHTML += `</div></div>`; // Tutup bungkus per-pool
        });
        poolHTML += '</div>';
        container.innerHTML = poolHTML;

        // Panggil SVG Penggambar Garis
        setTimeout(() => { drawBracketLines(catName); }, 50);

    } catch (err) { console.error(err); }
}

// -------------------------------------------------------------
// FUNGSI CARD DENGAN KOTAK INDIKATOR SUMBER PERMANEN (KIRI)
// -------------------------------------------------------------
function generateMatchCardHTML(m, isGroupEmbu, poolName, allMatchesInPool) {
    let displayNum = m.matchNum % 50 === 0 ? 50 : m.matchNum % 50;
    let pMerah = STATE.participants.find(p => p.id === m.merahId);
    let pPutih = STATE.participants.find(p => p.id === m.putihId);

    // REVERSE LOOKUP: Cari tahu partai mana yang mengirim pemenang/kalah ke slot ini
    let mrhSource = allMatchesInPool.find(prev => (prev.nextW === m.matchNum && prev.nextWSlot === 1) || (prev.nextL === m.matchNum && prev.nextLSlot === 1));
    let pthSource = allMatchesInPool.find(prev => (prev.nextW === m.matchNum && prev.nextWSlot === 2) || (prev.nextL === m.matchNum && prev.nextLSlot === 2));

    // GENERATE TEKS KOTAK INDIKATOR
    let srcMrhText = "";
    if (mrhSource) {
        let isW = mrhSource.nextW === m.matchNum;
        let num = mrhSource.matchNum % 50 === 0 ? 50 : mrhSource.matchNum % 50;
        srcMrhText = `${isW ? 'W' : 'L'}${num}`;
    }

    let srcPthText = "";
    if (pthSource) {
        let isW = pthSource.nextW === m.matchNum;
        let num = pthSource.matchNum % 50 === 0 ? 50 : pthSource.matchNum % 50;
        srcPthText = `${isW ? 'W' : 'L'}${num}`;
    }

    // NAMA ATLET
    let nMerahRaw = m.merahId === -1 ? "BYE" : (pMerah ? formatNama(pMerah.nama, 'inline') : "Menunggu...");
    let nPutihRaw = m.putihId === -1 ? "BYE" : (pPutih ? formatNama(pPutih.nama, 'inline') : "Menunggu...");

    let kMerahRaw = pMerah ? pMerah.kontingen : "";
    let kPutihRaw = pPutih ? pPutih.kontingen : "";

    let bgStyle = m.status === 'done' ? 'border-green-600 bg-slate-800' : m.status === 'auto-win' ? 'border-slate-600 bg-slate-900 opacity-60' : 'border-blue-500 bg-slate-800';
    let wMerah = m.winnerId === m.merahId ? 'text-green-400' : m.winnerId && m.winnerId !== m.merahId ? 'text-slate-500 line-through' : 'text-red-400';
    let wPutih = m.winnerId === m.putihId ? 'text-green-400' : m.winnerId && m.winnerId !== m.putihId ? 'text-slate-500 line-through' : 'text-white';

    let dMerah = m.skorMerah > 0 ? m.skorMerah : '';
    let dPutih = m.skorPutih > 0 ? m.skorPutih : '';

    let boxWidthClass = isGroupEmbu ? "w-72" : "w-[260px] max-w-[320px]";
    let textClass = isGroupEmbu ? "truncate block w-full" : "whitespace-normal break-words w-full leading-tight";
    let tooltipMerah = isGroupEmbu ? `title="${nMerahRaw}"` : "";
    let tooltipPutih = isGroupEmbu ? `title="${nPutihRaw}"` : "";

    const renderSourceBox = (text, isLoser) => {
        if (!text) return `<div class="w-7 flex items-center justify-center bg-slate-900/30 border-r border-slate-700/50 flex-shrink-0"></div>`;
        let textColor = isLoser ? 'text-orange-500' : 'text-yellow-500';
        let bgColor = isLoser ? 'bg-orange-950/20' : 'bg-slate-950';
        return `<div class="w-7 flex items-center justify-center ${bgColor} border-r border-slate-700/50 flex-shrink-0 text-[10px] font-black tracking-tighter ${textColor}" title="Berasal dari Partai ${text}">${text}</div>`;
    };

    // 👇 FIX: Pisahkan Ikon Info dan Ikon Undo ke posisi yang tepat 👇
    let infoIconHTML = "";
    let undoIconHTML = "";

    if (m.status === 'done' || m.status === 'auto-win') {
        let tooltipText = "Data petugas tidak tersedia.";
        const catObj = STATE.categories.find(c => c.name === m.kategori);

        if (catObj && catObj.discipline === 'embu') {
            let pM = m.petugasMerah || [];
            let pP = m.petugasPutih || [];
            if (pM.length > 0 || pP.length > 0) {
                tooltipText = "WASIT PITA MERAH:\\n" + pM.map((n, i) => `${i + 1}. ${n}`).join('\\n') + "\\n\\nWASIT PITA PUTIH:\\n" + pP.map((n, i) => `${i + 1}. ${n}`).join('\\n');
            }
        } else {
            if (m.petugas) {
                tooltipText = `WASIT UTAMA:\\n${m.petugas.wasitUtama}\\n\\nOFFICIAL MERAH:\\n${m.petugas.offMerah}\\n\\nOFFICIAL PUTIH:\\n${m.petugas.offPutih}`;
            }
        }

        // Ikon Info menempel mungil di sebelah teks posisi bagan
        infoIconHTML = `<i class="fas fa-info-circle text-blue-400 hover:text-blue-300 cursor-help ml-1.5 transition-transform hover:scale-110" title="${tooltipText}"></i>`;

        // Ikon Undo melayang mandiri di luar sudut kanan atas
        undoIconHTML = `
        <div class="absolute -top-3 -right-3 z-50">
            <button onclick="undoMatchResult(${m.id})" title="Batalkan Hasil Partai Ini (Undo)" class="bg-slate-800 hover:bg-red-600 text-slate-400 hover:text-white w-7 h-7 rounded-full flex items-center justify-center shadow-lg border border-slate-600 hover:border-red-500 cursor-pointer transition-colors duration-300 focus:outline-none">
                <i class="fas fa-undo text-[10px]"></i>
            </button>
        </div>`;
    }

    return `
        <div id="match-box-${poolName}-${m.matchNum}" data-nextw="${m.nextW}" data-nextl="${m.nextL}" data-pool="${poolName}" class="bracket-match rounded-md border-2 ${bgStyle} relative shadow-md transition-all flex-none ${boxWidthClass} athlete-match-${m.merahId} athlete-match-${m.putihId}">
            
            ${undoIconHTML} <!-- 👈 Ikon Undo di luar kartu -->

            <div class="flex items-center justify-between bg-slate-900/60 px-2 py-1.5 border-b border-slate-700/50">
                <div class="flex items-center">
                    <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">G${displayNum} &bull; ${m.babak}</span>
                    ${infoIconHTML} <!-- 👈 Ikon Info (i) persis di sebelah teks -->
                </div>
            </div>
            
            <div class="flex flex-col">
                <!-- SUDUT MERAH -->
                <div class="flex justify-between items-stretch border-b border-slate-700/50 min-h-[44px]">
                    ${renderSourceBox(srcMrhText, srcMrhText.includes('L'))}
                    <div class="flex-1 min-w-0 px-2 py-1.5 flex items-center bg-slate-800/20">
                        <div class="flex flex-col min-w-0 w-full" ${tooltipMerah}>
                            <span class="text-xs font-bold ${wMerah} ${textClass}">${nMerahRaw}</span>
                            ${kMerahRaw ? `<span class="text-[9px] text-slate-500 uppercase font-bold mt-0.5 truncate">${kMerahRaw}</span>` : ''}
                        </div>
                    </div>
                    <div class="w-10 flex items-center justify-center border-l border-slate-700/50 bg-slate-900/30 flex-shrink-0">
                        <span class="font-mono font-bold text-sm ${wMerah}">${dMerah}</span>
                    </div>
                </div>

                <!-- SUDUT PUTIH -->
                <div class="flex justify-between items-stretch min-h-[44px]">
                    ${renderSourceBox(srcPthText, srcPthText.includes('L'))}
                    <div class="flex-1 min-w-0 px-2 py-1.5 flex items-center bg-slate-800/20">
                        <div class="flex flex-col min-w-0 w-full" ${tooltipPutih}>
                            <span class="text-xs font-bold ${wPutih} ${textClass}">${nPutihRaw}</span>
                            ${kPutihRaw ? `<span class="text-[9px] text-slate-500 uppercase font-bold mt-0.5 truncate">${kPutihRaw}</span>` : ''}
                        </div>
                    </div>
                    <div class="w-10 flex items-center justify-center border-l border-slate-700/50 bg-slate-900/30 flex-shrink-0">
                        <span class="font-mono font-bold text-sm ${wPutih}">${dPutih}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ==========================================
// ENGINE SVG: PENGGAMBAR GARIS BAGAN DINAMIS
// ==========================================
function drawBracketLines(catName) {
    const catMatches = STATE.matches.filter(m => m.kategori === catName);
    let pools = [...new Set(catMatches.map(m => m.pool))];

    pools.forEach(poolName => {
        const svg = document.getElementById(`canvas-pool-${poolName}`);
        if (!svg) return;

        svg.innerHTML = ''; // Bersihkan kanvas

        const poolMatches = catMatches.filter(m => m.pool === poolName);

        poolMatches.forEach(m => {
            const boxA = document.getElementById(`match-box-${poolName}-${m.matchNum}`);
            if (!boxA) return;

            // HANYA MENGGAMBAR GARIS ALUR KEMENANGAN (WINNER BRACKET & ALUR LOSER BRACKET INTERNAL)
            if (m.nextW && m.nextW !== 'WINNER') {
                const boxW = document.getElementById(`match-box-${poolName}-${m.nextW}`);
                if (boxW) drawLine(svg, boxA, boxW, '#3b82f6', false); // Garis Biru Solid (blue-500)
            }

            // NOTE: Blok untuk m.nextL (Garis Oranye Putus-putus menyilang) telah dimatikan 
            // agar visual lebih rapi dan standar internasional.
        });
    });
}

function drawLine(svg, boxA, boxB, color, isDashed) {
    const svgRect = svg.getBoundingClientRect();
    const rectA = boxA.getBoundingClientRect();
    const rectB = boxB.getBoundingClientRect();

    const x1 = (rectA.right - svgRect.left) + 4;
    const y1 = (rectA.top + (rectA.height / 2)) - svgRect.top;

    const x2 = (rectB.left - svgRect.left) - 4;
    const y2 = (rectB.top + (rectB.height / 2)) - svgRect.top;

    const midX = x1 + (x2 - x1) / 2;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const d = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;

    path.setAttribute("d", d);
    path.setAttribute("fill", "transparent");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", "2.5");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("opacity", "0.8");

    svg.appendChild(path);
}

// 🌟 PELATUK RESPONSIVE: Gambar ulang garis jika ukuran jendela browser berubah
window.addEventListener('resize', () => {
    const catName = document.getElementById('draw-select-kategori').value;
    const container = document.getElementById('randori-bracket-container');
    if (catName && container && !container.classList.contains('hidden')) {
        drawBracketLines(catName);
    }
});

// ==========================================
// FUNGSI GENERATOR KARTU SLOT (PANEL KIRI)
// ==========================================
function generateSlotCard(slotNum, athleteId, mode, juara1Nama) {
    if (athleteId === -1) {
        // SLOT BYE (Redup)
        return `
        <div class="flex items-center gap-2 p-1.5 rounded-lg border border-slate-700 bg-slate-800/30 text-slate-500 text-xs shadow-sm">
            <div class="w-6 h-6 rounded flex items-center justify-center bg-slate-700/60 font-black flex-shrink-0 text-[10px] border border-slate-600">${slotNum}</div>
            <div class="font-bold tracking-widest uppercase opacity-50 text-[10px]">BYE (KOSONG)</div>
        </div>`;
    }

    let p = STATE.participants.find(x => x.id === athleteId);
    if (!p) {
        // MENUNGGU (Blank Slot dari babak lanjutan)
        return `
        <div class="flex items-center gap-2 p-1.5 rounded-lg border border-slate-700/50 bg-slate-800/20 text-slate-500 text-xs shadow-sm">
            <div class="w-6 h-6 rounded flex items-center justify-center bg-slate-700/30 font-bold flex-shrink-0 text-[10px] border border-slate-600/50">${slotNum}</div>
            <div class="font-bold tracking-widest italic opacity-50 text-[10px]">Menunggu...</div>
        </div>`;
    }

    // ATLET AKTIF
    let statusColor = "border-slate-700 bg-slate-800/90 text-slate-200"; // Netral
    let statusIcon = ""; // <--- HILANGKAN BULLET BIRU SECARA DEFAULT

    // Pindahkan Ikon (Mahkota/Tengkorak) agar menempel di sebelah NAMA ATLET, bukan di bawah angka
    if (p.nama === juara1Nama) {
        statusColor = "border-yellow-500 bg-yellow-900/20 text-yellow-400 shadow-[0_0_10px_rgba(234,179,8,0.15)]";
        statusIcon = "<i class='fas fa-crown text-yellow-500 text-[10px] ml-1.5 drop-shadow-md' title='Juara 1'></i>";
    } else if ((mode === 'double' && p.losses >= 2) || (mode === 'single' && p.losses >= 1)) {
        statusColor = "border-red-900/50 bg-red-950/20 text-slate-500 opacity-60";
        statusIcon = "<i class='fas fa-skull-crossbones text-red-500/70 text-[10px] ml-1.5' title='Gugur'></i>";
    } else if (mode === 'double' && p.losses === 1) {
        statusColor = "border-orange-700 bg-orange-900/20 text-orange-400";
        statusIcon = "<i class='fas fa-exclamation-triangle text-orange-500 text-[10px] ml-1.5 drop-shadow-sm' title='Loser Bracket'></i>";
    }

    // 🎯 SENSOR HOVER ON/OFF (Dan perbaikan struktur Flex)
    return `
    <div onmouseenter="highlightAthlete(${p.id})" onmouseleave="removeHighlightAthlete(${p.id})" class="flex items-center gap-2.5 p-1.5 rounded-lg border ${statusColor} text-xs transition-all cursor-pointer hover:bg-slate-700 hover:border-slate-400 shadow-sm group">
        <div class="w-6 flex items-center justify-center flex-shrink-0">
            <div class="w-6 h-6 rounded flex items-center justify-center bg-slate-700/80 font-black border border-slate-600 text-[10px] text-white shadow-inner">${slotNum}</div>
        </div>
        <div class="flex-1 min-w-0 flex flex-col justify-center">
            <div class="font-bold truncate leading-tight group-hover:text-yellow-400 transition-colors text-[11px] flex items-center">
                ${p.nama} ${statusIcon}
            </div>
            <div class="text-[9px] font-bold opacity-70 mt-0.5 uppercase tracking-wider flex items-center"><i class="fas fa-shield-alt mr-1 text-slate-500"></i><span class="truncate">${p.kontingen}</span></div>
        </div>
    </div>`;
}

function renderEmbuLayout(catName, container, poolsConfig) {
    let gridCols = poolsConfig.length > 1 ? 'md:grid-cols-2' : 'grid-cols-1';
    let html = `
    <div class="col-span-full w-full shadow-lg rounded-xl overflow-hidden border border-slate-700">
        <div class="flex justify-between items-center bg-slate-800 p-4 border-b border-slate-700">
            <div class="flex items-center gap-3">
                <span class="bg-blue-600 text-white text-[10px] px-2 py-1 rounded font-black tracking-wider">DRAWING EMBU</span>
                <span class="text-sm font-bold text-yellow-400 truncate">${catName}</span>
            </div>
            <span class="text-[10px] text-slate-400 font-mono hidden md:block">Swap: Klik Nama ke Nama Lain</span>
            <button onclick="resetNilaiKategoriLokal()" class="bg-red-900/50 border border-red-700 text-red-400 hover:bg-red-500 hover:text-white w-8 h-8 rounded flex items-center justify-center transition-colors shadow-sm" title="Kosongkan Nilai (Urutan Tetap)"><i class="fas fa-eraser text-sm"></i></button>
        </div>
        <div class="grid grid-cols-1 ${gridCols} gap-6 bg-slate-900 p-5">`;

    poolsConfig.forEach(pool => {
        let borderColor = pool.isFinal || pool.isB2 ? 'border-yellow-600' : 'border-slate-600';
        let titleColor = pool.isFinal || pool.isB2 ? 'text-yellow-500' : 'text-purple-400';

        let poolType = pool.isFinal ? 'final' : (pool.isB2 ? 'b2' : 'b1');

        html += `<div class="bg-slate-800 p-4 md:p-5 rounded-xl border ${borderColor} shadow-sm w-full h-full flex flex-col">
            <h3 class="font-black text-center ${titleColor} mb-4 border-b border-slate-700 pb-3">${pool.title}</h3>
            <div class="space-y-3 flex-1">`;

        // FIX: Tambahkan parameter 'index' di sini untuk menghitung baris
        pool.data.forEach((p, index) => {
            let noUrut = pool.isFinal ? p.urutFinal : (pool.isB2 ? p.urutB2 : p.urut);

            // FIX "UNDEFINED": Jika noUrut kosong/undefined, gunakan nomor baris (index + 1)
            if (!noUrut) noUrut = index + 1;

            let isSelected = (EMBU_SWAP_SELECTION && EMBU_SWAP_SELECTION.id === p.id && EMBU_SWAP_SELECTION.type === poolType);
            let activeClass = isSelected
                ? 'bg-yellow-600/40 border-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.3)]'
                : 'bg-slate-900/50 border-slate-700/50 hover:bg-slate-700/40';

            // --- FIX TATA LETAK: 1 Baris, Kontingen di Kanan, Nama Truncate (...) ---
            html += `<div onclick="handleEmbuSwap(${p.id}, '${poolType}')" class="cursor-pointer flex flex-row items-center justify-between text-sm p-3 rounded-lg border gap-3 transition-all duration-200 ${activeClass}">
                
                <div class="flex gap-2 items-center w-full min-w-0">
                    <span class="font-mono ${isSelected ? 'text-yellow-400' : 'text-slate-500'} w-5 text-right flex-shrink-0">${noUrut}.</span>
                    <span class="font-bold ${isSelected ? 'text-yellow-400' : 'text-white'} truncate block w-full">${p.nama}</span>
                </div>
                
                <div class="flex-shrink-0">
                    <span class="text-[10px] ${isSelected ? 'text-yellow-200 bg-yellow-900/50 border-yellow-600' : 'text-slate-400 bg-slate-800 border-slate-700'} px-2 py-1 rounded border whitespace-nowrap shadow-sm">${p.kontingen}</span>
                </div>
                
            </div>`;
        });
        html += `</div></div>`;
    });
    html += `</div></div>`;
    container.innerHTML = html;
}

// INJEKSI DOM UNTUK TOMBOL UNDUH JADWAL (MIKRO)
function checkExistingDrawing() {
    const catName = document.getElementById('draw-select-kategori').value;
    const panelEmbu = document.getElementById('draw-panel-embu');
    const panelRandori = document.getElementById('draw-panel-randori');
    const panelEmpty = document.getElementById('draw-panel-empty');
    const resultDiv = document.getElementById('drawing-result');

    panelEmbu.classList.add('hidden');
    panelRandori.classList.add('hidden');
    panelEmpty.classList.add('hidden');
    resultDiv.innerHTML = '';

    // 👇 GANTI BAGIAN PENUTUP WADAH LAMA MENJADI INI 👇
    let wrapper = document.getElementById('randori-layout-wrapper');
    if (wrapper) wrapper.classList.add('hidden');
    document.getElementById('randori-bracket-container').classList.add('hidden');

    let drawHeader = document.querySelector('#section-drawing > div:first-child');
    let microDrawBtn = document.getElementById('btn-micro-draw-export');
    if (!microDrawBtn && drawHeader) {
        microDrawBtn = document.createElement('button');
        microDrawBtn.id = 'btn-micro-draw-export';

        // 🌟 DIUBAH: Desain minimalis elegan dengan Ikon Print 🌟
        microDrawBtn.className = 'w-full md:w-auto bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2.5 px-5 rounded-lg border border-slate-600 shadow-md transition-colors text-xs flex items-center justify-center gap-2 mt-4 md:mt-0 tracking-widest';
        microDrawBtn.innerHTML = '<i class="fas fa-print text-blue-400 text-base"></i> CETAK BAGAN';

        // 🌟 DIUBAH: Memanggil fungsi cetak khusus (Bukan Excel lagi) 🌟
        microDrawBtn.onclick = () => printVisualBracket(document.getElementById('draw-select-kategori').value);
        drawHeader.appendChild(microDrawBtn);
    }

    if (!catName) {
        panelEmpty.classList.remove('hidden');
        if (microDrawBtn) microDrawBtn.classList.add('hidden');
        return;
    }
    if (microDrawBtn) microDrawBtn.classList.remove('hidden');

    const categoryObj = STATE.categories.find(c => c.name === catName);
    let list = STATE.participants.filter(p => p.kategori === catName);

    // Tambahkan detektor cerdas ini sebelum blok if
    let isEmbuH2H = categoryObj && categoryObj.discipline === 'embu' && STATE.settings && STATE.settings.embuFormat === 'h2h';

    // Ubah logika pengecekannya menjadi:
    if (categoryObj && (categoryObj.discipline === 'randori' || isEmbuH2H)) {
        panelRandori.classList.remove('hidden');

        // Ubah teks tombol secara dinamis
        let btnDrawRandori = document.querySelector('#draw-panel-randori button');
        if (btnDrawRandori) {
            btnDrawRandori.innerHTML = `<i class="fas fa-project-diagram"></i> GENERATE BAGAN ${isEmbuH2H ? 'EMBU (H2H)' : 'BARU'}`;
        }

        renderVisualBracket(catName);
    } else if (categoryObj && categoryObj.discipline === 'festival') {
        // --- RENDER DRAWING FESTIVAL ---
        panelEmbu.classList.remove('hidden');
        if (list.some(p => p.urut > 0)) {
            let uniquePools = [...new Set(list.map(p => p.pool))].sort();
            let poolsData = uniquePools.map(poolName => {
                let poolList = list.filter(p => p.pool === poolName).sort((a, b) => a.urut - b.urut);
                return { data: poolList, title: "KELOMPOK " + poolName, isFinal: false, isB2: false };
            });
            renderEmbuLayout(catName, resultDiv, poolsData);
        } else {
            resultDiv.innerHTML = `<div class="col-span-full text-center text-slate-500 py-10 border-2 border-dashed border-slate-700 rounded-xl">Belum diundi.</div>`;
        }
    } else {
        // --- RENDER DRAWING EMBU (ASLI) ---
        panelEmbu.classList.remove('hidden');
        const isFinalMode = list.some(p => p.isFinalist);

        if (isFinalMode) {
            let finalL = list.filter(p => p.isFinalist);
            if (finalL.some(p => p.urutFinal > 0)) {
                finalL.sort((a, b) => a.urutFinal - b.urutFinal);
                renderEmbuLayout(catName, resultDiv, [{ data: finalL, title: "POOL FINAL", isFinal: true }]);
            } else {
                resultDiv.innerHTML = `<div class="col-span-full text-center text-yellow-500 py-10 border-2 border-dashed border-yellow-600 rounded-xl">Peserta Final dipilih. Klik Acak Urutan.</div>`;
            }
        } else if (list.some(p => p.urut > 0)) {
            // SUDAH DIUNDI BABAK 1
            // SUDAH DIUNDI BABAK 1 DINAMIS
            if (list.some(p => p.pool !== 'SINGLE' && p.pool !== '-')) {
                list.sort((a, b) => a.pool.localeCompare(b.pool) || a.urut - b.urut);
                let uniquePools = [...new Set(list.map(p => p.pool))].sort();
                let poolsData = uniquePools.map(poolName => {
                    return {
                        data: list.filter(p => p.pool === poolName),
                        title: "POOL " + poolName,
                        isFinal: false
                    };
                });
                renderEmbuLayout(catName, resultDiv, poolsData);
            } else {
                // JALUR SINGLE POOL - Cek setting Admin (Dibalik, Diacak Ulang, atau Peringkat)
                let modeB2 = (STATE.settings && STATE.settings.embuB2Mode) ? STATE.settings.embuB2Mode : 'reverse';

                // --- CEK SYARAT EKSIBISI 1 BABAK ---
                let minPeserta = (STATE.settings && STATE.settings.minPesertaJuara) ? parseInt(STATE.settings.minPesertaJuara) : 1;
                let isEksibisi = (list.length < minPeserta && STATE.settings && STATE.settings.eksibisiLangsungFinal === true);

                // --- PENYIMPANAN OTOMATIS URUTAN B2 UNTUK PRINT CENTER ---
                let needsFirebaseSync = false;
                let syncUpdates = {};
                // -----------------------------------------------------------

                // BYPASS DRAWING: Jika masuk mode eksibisi, JANGAN BIKIN KOTAK BABAK 2!
                if (isEksibisi) {
                    let listB1 = [...list].sort((a, b) => a.urut - b.urut);
                    renderEmbuLayout(catName, resultDiv, [
                        { data: listB1, title: "BABAK 1 (LANGSUNG FINAL / EKSIBISI)", isFinal: false, isB2: false }
                    ]);
                }
                else if (modeB2 === 'redraw') {
                    let listB1 = [...list].sort((a, b) => a.urut - b.urut);
                    let listB2 = [...list].filter(p => p.urutB2 > 0).sort((a, b) => a.urutB2 - b.urutB2);
                    let poolsData = [{ data: listB1, title: "BABAK 1", isFinal: false, isB2: false }];

                    if (listB2.length > 0) poolsData.push({ data: listB2, title: "BABAK 2", isFinal: false, isB2: true });
                    renderEmbuLayout(catName, resultDiv, poolsData);

                    resultDiv.innerHTML += `<div class="col-span-full mt-6 text-center"><button onclick="startDrawingB2()" class="bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 px-6 rounded-xl shadow-lg border border-purple-400 transition-transform hover:scale-105"><i class="fas fa-random mr-2"></i>ACAK URUTAN BABAK 2 SEKARANG</button></div>`;

                } else if (modeB2 === 'highscore') {
                    let listB1 = [...list].sort((a, b) => a.urut - b.urut);
                    // Filter yang sudah main B1, urutkan dari nilai TERENDAH ke TERTINGGI (Ascending)
                    let listB2 = [...list].filter(p => p.scores.b1.final > 0).sort((a, b) => a.scores.b1.final - b.scores.b1.final || a.scores.b1.tech - b.scores.b1.tech);

                    // --- SAVE KE FIREBASE (HIGHSCORE) ---
                    listB2.forEach((p, index) => {
                        let newUrut = index + 1;
                        if (p.urutB2 !== newUrut) {
                            p.urutB2 = newUrut; // Update UI Lokal
                            let pIndex = STATE.participants.findIndex(x => x.id === p.id);
                            syncUpdates[`turnamen_data/participants/${pIndex}/urutB2`] = newUrut; // Siapkan paket Firebase
                            needsFirebaseSync = true;
                        }
                    });

                    let poolsData = [{ data: listB1, title: "BABAK 1", isFinal: false, isB2: false }];

                    if (listB2.length > 0) poolsData.push({ data: listB2, title: "BABAK 2 (BERDASARKAN PERINGKAT)", isFinal: false, isB2: true });
                    renderEmbuLayout(catName, resultDiv, poolsData);

                    if (listB2.length < list.length) {
                        resultDiv.innerHTML += `<div class="col-span-full mt-4 text-center text-slate-500 italic text-sm">Selesaikan penilaian Babak 1 untuk melihat susunan penuh Babak 2.</div>`;
                    }
                } else {
                    // MODE DIBALIK (REVERSE)
                    let listB1 = [...list].sort((a, b) => a.urut - b.urut);
                    let listB2 = [...list].sort((a, b) => b.urut - a.urut);

                    // --- SAVE KE FIREBASE (REVERSE) ---
                    listB2.forEach((p, index) => {
                        let newUrut = index + 1;
                        if (p.urutB2 !== newUrut) {
                            p.urutB2 = newUrut; // Update UI Lokal
                            let pIndex = STATE.participants.findIndex(x => x.id === p.id);
                            syncUpdates[`turnamen_data/participants/${pIndex}/urutB2`] = newUrut; // Siapkan paket Firebase
                            needsFirebaseSync = true;
                        }
                    });

                    renderEmbuLayout(catName, resultDiv, [
                        { data: listB1, title: "BABAK 1", isFinal: false, isB2: false },
                        { data: listB2, title: "BABAK 2 (URUTAN DIBALIK)", isFinal: false, isB2: true }
                    ]);
                }

                // --- EKSEKUSI FIREBASE BATCH UPDATE ---
                if (needsFirebaseSync && Object.keys(syncUpdates).length > 0) {
                    database.ref().update(syncUpdates).catch(err => console.error("Gagal sync urutB2:", err));
                }
            }
        } else {
            resultDiv.innerHTML = `<div class="col-span-full text-center text-slate-500 py-10 border-2 border-dashed border-slate-700 rounded-xl">Belum diundi.</div>`;
        }
    }
    // --- SINKRONISASI KE PROYEKTOR TM ---
    database.ref('turnamen_data/settings/projectorCategory').set(catName);

    // Tampilkan dropdown fase hanya jika Embu/Festival
    const projControls = document.getElementById('projector-controls');
    if (projControls) {
        if (categoryObj && categoryObj.discipline !== 'randori') {
            projControls.classList.remove('hidden');
        } else {
            projControls.classList.add('hidden');
        }
    }
}

// ==========================================
// MESIN CETAK BAGAN (VISUAL PDF) - PORTRAIT MICRO-CARD FIXED
// ==========================================
function printVisualBracket(catName) {
    let catMatches = STATE.matches.filter(m => m.kategori === catName);
    if (catMatches.length === 0) return alert("Belum ada bagan pertandingan yang bisa dicetak!");

    let pools = [...new Set(catMatches.map(m => m.pool))].sort();

    let printWin = window.open('', '_blank');
    printWin.document.write(`
        <html><head><title>Cetak Bagan - ${catName}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">
        <style>
            /* 🌟 KERTAS PORTRAIT 🌟 */
            @page { size: portrait; margin: 8mm; }
            body { background: white; color: black; font-family: 'Inter', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; box-sizing: border-box;}
            .page-break { page-break-after: always; }
            
            /* Pembungkus Fleksibel Satu Halaman */
            .page-wrapper { width: 100%; height: 95vh; display: flex; flex-direction: column; overflow: hidden; page-break-inside: avoid;}
            
            /* Header */
            h2 { flex: 0 0 auto; margin: 0 0 10px 0; padding-bottom: 5px; border-bottom: 2px solid #000; font-weight: 900; text-transform: uppercase; font-size: 16px;}
            
            /* Area Bagan (Fleksibel & Mengecil Otomatis) */
            .bracket-area { flex: 1 1 auto; position: relative; width: 100%; display: flex; flex-direction: column; justify-content: flex-start; overflow: hidden;}
            
            /* 🌟 DIET KETAT: Jarak Antar Kolom Diperkecil 🌟 */
            .grid-wrapper { display: flex; flex-direction: row; gap: 15px; position: relative; width: max-content;}
            .col-wrapper { display: flex; flex-direction: column; justify-content: space-around; position: relative; z-index: 2; flex: 1;}
            
            /* Garis SVG */
            svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none; }
            
            /* 🌟 MICRO-CARD CSS (Sangat Rapat & Sempit) 🌟 */
            .match-box { border: 1.5px solid #333; border-radius: 4px; width: 135px; background: #fff; display: flex; flex-direction: column; position: relative; z-index: 10; margin: 4px 0;}
            .match-header { border-bottom: 1px solid #333; padding: 2px 4px; font-size: 7px; font-weight: 900; background: #f1f5f9; display:flex; justify-content: space-between;}
            .match-slot { display: flex; align-items: center; font-size: 8px; font-weight: 700; border-bottom: 1px solid #e2e8f0; height: 24px; padding: 0;}
            .match-slot:last-child { border-bottom: none; }
            .src-box { width: 16px; text-align: center; border-right: 1px solid #e2e8f0; background: #f8fafc; font-size: 6px; color: #475569; font-weight: 900; align-self: stretch; display: flex; align-items: center; justify-content: center;}
            .score-box { border-left: 1px solid #333; padding: 0 4px; font-family: monospace; font-size: 10px; margin-left: auto; font-weight: 900; height: 100%; display: flex; align-items: center; justify-content: center; min-width: 18px;}
            .ath-info { display: flex; flex-direction: column; min-width: 0; padding: 2px 4px; flex: 1;}
            .knt { font-size: 5px; color: #64748b; text-transform: uppercase; font-weight: 700; margin-top: 1px;}
            
            /* Area Tabel (Di Bawah) */
            .table-area { flex: 0 0 auto; margin-top: 10px; border-top: 1.5px dashed #94a3b8; padding-top: 8px;}
            h3 { font-size: 11px; font-weight: 900; margin: 0 0 5px 0;}
            table { width: 100%; border-collapse: collapse; font-size: 8px; }
            th, td { border: 1px solid #cbd5e1; padding: 3px 5px; text-align: left; }
            th { background: #f8fafc; font-weight: 900; text-transform: uppercase; }
            
            .scale-wrapper { transform-origin: top left; display: inline-block; width: max-content;}
        </style>
        </head><body>
    `);

    const renderPrintMatch = (m, poolName, allMatchesInPool) => {
        let displayNum = m.matchNum % 50 === 0 ? 50 : m.matchNum % 50;
        let pMrh = STATE.participants.find(p => p.id === m.merahId);
        let pPth = STATE.participants.find(p => p.id === m.putihId);

        let mrhSource = allMatchesInPool.find(prev => (prev.nextW === m.matchNum && prev.nextWSlot === 1) || (prev.nextL === m.matchNum && prev.nextLSlot === 1));
        let pthSource = allMatchesInPool.find(prev => (prev.nextW === m.matchNum && prev.nextWSlot === 2) || (prev.nextL === m.matchNum && prev.nextLSlot === 2));

        let srcMrhText = mrhSource ? `${mrhSource.nextW === m.matchNum ? 'W' : 'L'}${mrhSource.matchNum % 50 === 0 ? 50 : mrhSource.matchNum % 50}` : "";
        let srcPthText = pthSource ? `${pthSource.nextW === m.matchNum ? 'W' : 'L'}${pthSource.matchNum % 50 === 0 ? 50 : pthSource.matchNum % 50}` : "";

        let nMerah = m.merahId === -1 ? "BYE" : (pMrh ? pMrh.nama.split(',')[0] : "Menunggu...");
        let kMerah = m.merahId === -1 ? "-" : (pMrh ? pMrh.kontingen : "");
        let nPutih = m.putihId === -1 ? "BYE" : (pPth ? pPth.nama.split(',')[0] : "Menunggu...");
        let kPutih = m.putihId === -1 ? "-" : (pPth ? pPth.kontingen : "");

        let sMrh = m.skorMerah > 0 ? m.skorMerah : '';
        let sPth = m.skorPutih > 0 ? m.skorPutih : '';

        return `
            <div class="match-box" id="box-${poolName}-${m.matchNum}">
                <div class="match-header"><span>G-${displayNum}</span><span>${m.babak}</span></div>
                <div class="match-slot">
                    <div class="src-box">${srcMrhText}</div>
                    <div class="ath-info">
                        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: 85px;">${nMerah}</span><span class="knt">${kMerah}</span>
                    </div>
                    <div class="score-box">${sMrh}</div>
                </div>
                <div class="match-slot">
                    <div class="src-box">${srcPthText}</div>
                    <div class="ath-info">
                        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: 85px;">${nPutih}</span><span class="knt">${kPutih}</span>
                    </div>
                    <div class="score-box">${sPth}</div>
                </div>
            </div>
        `;
    };

    pools.forEach((poolName, idx) => {
        let poolMatches = catMatches.filter(m => m.pool === poolName);

        printWin.document.write(`<div class="page-wrapper ${idx < pools.length - 1 ? 'page-break' : ''}">`);

        // Pembungkus Total untuk Scale-Down
        printWin.document.write(`<div class="scale-wrapper" id="scale-wrapper-${poolName}">`);
        printWin.document.write(`<h2>${catName} ${poolName !== '-' && poolName !== 'SINGLE' ? '- POOL ' + poolName : ''}</h2>`);

        // --- AREA BAGAN ---
        printWin.document.write(`<div class="bracket-area" id="bracket-area-${poolName}">`);
        printWin.document.write(`<svg id="svg-${poolName}"></svg>`);

        let columns = [...new Set(poolMatches.map(m => m.col))].sort((a, b) => a - b);
        let wbRowHTML = `<div class="grid-wrapper">`;
        let lbRowHTML = `<div class="grid-wrapper" style="margin-top: 10px;">`;
        let hasLB = false;

        columns.forEach(colNum => {
            let colMatches = poolMatches.filter(m => m.col === colNum).sort((a, b) => a.matchNum - b.matchNum);
            let wbMatches = colMatches.filter(m => !m.babak.toUpperCase().includes('LB') && !m.babak.toUpperCase().includes('BAWAH'));
            let lbMatches = colMatches.filter(m => m.babak.toUpperCase().includes('LB') || m.babak.toUpperCase().includes('BAWAH'));

            if (lbMatches.length > 0) hasLB = true;

            wbRowHTML += `<div class="col-wrapper">`;
            wbMatches.forEach(m => { wbRowHTML += renderPrintMatch(m, poolName, poolMatches); });
            wbRowHTML += `</div>`;

            lbRowHTML += `<div class="col-wrapper">`;
            lbMatches.forEach(m => { lbRowHTML += renderPrintMatch(m, poolName, poolMatches); });
            lbRowHTML += `</div>`;
        });
        wbRowHTML += `</div>`;
        lbRowHTML += `</div>`;

        printWin.document.write(wbRowHTML);
        if (hasLB) {
            printWin.document.write(`<div style="text-align: center; margin: 4px 0;"><span style="background: white; padding: 0 5px; color: #f97316; font-size: 7px; font-weight: bold;">JALUR LOSER BRACKET</span></div>`);
            printWin.document.write(lbRowHTML);
        }
        printWin.document.write(`</div>`); // Tutup bracket-area

        // --- AREA TABEL ATLET (LOGIKA EMAS DIKEMBALIKAN!) ---
        printWin.document.write(`<div class="table-area">`);
        printWin.document.write(`<h3>Daftar Atlet di Pool Ini</h3>`);
        printWin.document.write(`<table><thead><tr><th style="width:30px;text-align:center;">NO</th><th>KONTINGEN</th><th>NAMA ATLET</th></tr></thead><tbody>`);

        // Sedot ID atlet langsung dari mesin bagan (Anti-Gagal)
        let poolAthleteIds = new Set();
        poolMatches.forEach(m => {
            if (m.merahId && m.merahId !== -1) poolAthleteIds.add(m.merahId);
            if (m.putihId && m.putihId !== -1) poolAthleteIds.add(m.putihId);
        });

        // Filter atlet dan urutkan berdasarkan kontingen agar rapi dibaca
        let poolParts = STATE.participants.filter(p => poolAthleteIds.has(p.id)).sort((a, b) => a.kontingen.localeCompare(b.kontingen) || a.nama.localeCompare(b.nama));

        if (poolParts.length === 0) {
            printWin.document.write(`<tr><td colspan="3" style="text-align:center; font-style:italic;">Belum ada atlet / Data kosong</td></tr>`);
        } else {
            poolParts.forEach((p, index) => {
                printWin.document.write(`<tr><td style="text-align:center; font-weight:bold;">${index + 1}</td><td style="font-weight:bold;">${p.kontingen}</td><td>${p.nama}</td></tr>`);
            });
        }
        printWin.document.write(`</tbody></table></div>`);

        printWin.document.write(`</div></div>`); // Tutup scale-wrapper & page-wrapper
    });

    // --- SCRIPT PENGGAMBAR GARIS & AUTO-SCALE ---
    printWin.document.write(`
        <script>
            window.onload = function() {
                const matches = ${JSON.stringify(catMatches)};
                const pools = ${JSON.stringify(pools)};
                
                pools.forEach(pool => {
                    const svg = document.getElementById('svg-' + pool);
                    const container = document.getElementById('bracket-area-' + pool);
                    if(!svg || !container) return;
                    
                    matches.filter(m => m.pool === pool).forEach(m => {
                        if (m.nextW && m.nextW !== 'WINNER') {
                            const boxA = document.getElementById('box-' + pool + '-' + m.matchNum);
                            const boxW = document.getElementById('box-' + pool + '-' + m.nextW);
                            if (boxA && boxW) {
                                const rectA = boxA.getBoundingClientRect();
                                const rectW = boxW.getBoundingClientRect();
                                const svgRect = container.getBoundingClientRect();
                                
                                const x1 = (rectA.right - svgRect.left) + 1;
                                const y1 = (rectA.top + (rectA.height / 2)) - svgRect.top;
                                const x2 = (rectW.left - svgRect.left) - 1;
                                const y2 = (rectW.top + (rectW.height / 2)) - svgRect.top;
                                const midX = x1 + (x2 - x1) / 2;
                                
                                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                                const d = \`M \${x1} \${y1} L \${midX} \${y1} L \${midX} \${y2} L \${x2} \${y2}\`;
                                
                                path.setAttribute("d", d); path.setAttribute("fill", "transparent");
                                path.setAttribute("stroke", "#94a3b8"); path.setAttribute("stroke-width", "1.5");
                                path.setAttribute("stroke-linejoin", "round");
                                svg.appendChild(path);
                            }
                        }
                    });
                });

                // 👇 KALKULASI AUTO-SCALE UNTUK KERTAS PORTRAIT A4 👇
                pools.forEach(pool => {
                    const wrapper = document.getElementById('scale-wrapper-' + pool);
                    
                    // Estimasi area cetak aman A4 Portrait (~750px lebar, ~1050px tinggi)
                    const maxWidth = 750; 
                    const maxHeight = 1050; 
                    
                    const cw = wrapper.scrollWidth;
                    const ch = wrapper.scrollHeight;
                    
                    let scaleX = 1;
                    let scaleY = 1;
                    
                    if (cw > maxWidth) scaleX = maxWidth / cw;
                    if (ch > maxHeight) scaleY = maxHeight / ch;
                    
                    let finalScale = Math.min(scaleX, scaleY);
                    
                    if (finalScale < 1) {
                        wrapper.style.transform = 'scale(' + finalScale + ')';
                        // Rapatkan sisa ruang kosong akibat scale down
                        wrapper.style.marginBottom = '-' + (ch * (1 - finalScale)) + 'px';
                        wrapper.style.marginRight = '-' + (cw * (1 - finalScale)) + 'px';
                    }
                });

                // Panggil Dialog Print setelah rendering & scaling selesai
                setTimeout(() => { window.print(); }, 800);
            }
        </script>
        </body></html>
    `);
    printWin.document.close();
}

// MESIN PENGACAK KHUSUS BABAK 2
function startDrawingB2() {
    const catName = document.getElementById('draw-select-kategori').value;
    if (!catName) return alert("Pilih kategori!");
    let list = STATE.participants.filter(p => p.kategori === catName && p.urut > 0);
    if (list.length === 0) return alert("Undi Babak 1 terlebih dahulu!");

    if (list.some(p => p.urutB2 > 0)) { if (!confirm("⚠️ Babak 2 SUDAH DIUNDI.\nYakin ingin mengacak ulang Babak 2?")) return; }

    let ids = list.map(p => p.id);
    shuffleArray(ids); // Gunakan mesin kocok yang sudah ada

    ids.forEach((id, index) => {
        const found = STATE.participants.find(item => item.id === id);
        if (found) found.urutB2 = index + 1;
    });

    saveToLocalStorage(); checkExistingDrawing(); filterPesertaScoring();
}

function startDrawing() {
    const catName = document.getElementById('draw-select-kategori').value;
    if (!catName) return alert("Pilih kategori!");
    let list = STATE.participants.filter(p => p.kategori === catName);
    if (list.length === 0) return alert("Belum ada peserta!");
    const catObj = STATE.categories.find(c => c.name === catName);

    // --- ALGORITMA KHUSUS FESTIVAL (PEMBAGI KELOMPOK CERDAS) ---
    if (catObj && catObj.discipline === 'festival') {
        if (list.some(p => p.urut > 0)) {
            if (!confirm("⚠️ Kategori FESTIVAL ini SUDAH DIUNDI.\nYakin ingin mengacak ulang dan mereset nilai?")) return;
            list.forEach(p => { p.scores = { b1: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 }, b2: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 } }; p.finalScore = 0; p.techScore = 0; });
        }

        // 1. KAMUS BOBOT SABUK (Huruf kecil semua untuk pencocokan)
        const kyuMap = { "minarai": 0, "kyu 8": 1, "kyu 7": 2, "kyu 6": 3, "kyu 5": 4, "kyu 4": 5, "kyu 3": 6, "kyu 2": 7, "kyu 1": 8, "dan 1": 9, "dan 2": 10, "dan 3": 11 };

        // 2. MULTI-LEVEL SORTING (Sabuk dulu, kalau sama, baru Umur)
        list.sort((a, b) => {
            let kyuA = String(a.kyu || "").toLowerCase().trim();
            let kyuB = String(b.kyu || "").toLowerCase().trim();

            // Jika sabuk aneh/kosong, lempar ke kelompok paling akhir (Bobot 999)
            let weightA = kyuMap[kyuA] !== undefined ? kyuMap[kyuA] : 999;
            let weightB = kyuMap[kyuB] !== undefined ? kyuMap[kyuB] : 999;

            if (weightA !== weightB) {
                return weightA - weightB; // Sort Sabuk Terendah ke Tertinggi
            }

            // Tie-Breaker: Sort Umur Termuda ke Tertua
            let umurA = parseInt(a.umur) || 0;
            let umurB = parseInt(b.umur) || 0;
            return umurA - umurB;
        });

        // 3. CHUNKING PEMBAGI KELOMPOK (Logic asli yang dipertahankan)
        let total = list.length;
        let numGroups = Math.ceil(total / 4);
        if (numGroups === 0) return;

        let baseSize = Math.floor(total / numGroups);
        let remainder = total % numGroups;
        let currentIndex = 0;
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

        for (let i = 0; i < numGroups; i++) {
            let groupSize = baseSize + (i < remainder ? 1 : 0);
            let poolName = alphabet[i] || `G${i + 1}`;
            for (let j = 0; j < groupSize; j++) {
                if (currentIndex < total) {
                    let p = STATE.participants.find(item => item.id === list[currentIndex].id);
                    if (p) {
                        p.pool = poolName;
                        p.urut = j + 1;
                    }
                    currentIndex++;
                }
            }
        }
        saveToLocalStorage(); checkExistingDrawing(); renderParticipantTable();
        return;
    }
    // -------------------------------------------------------------
    const isFinalMode = list.some(p => p.isFinalist);
    if (isFinalMode) {
        let finalL = list.filter(p => p.isFinalist);
        if (finalL.some(p => p.urutFinal > 0)) if (!confirm("⚠️ Finalis SUDAH DIUNDI.\nYakin ingin mengacak ulang?")) return;
        shuffleArray(finalL);
        finalL.forEach((p, index) => { const idx = STATE.participants.findIndex(x => x.id === p.id); STATE.participants[idx].urutFinal = index + 1; });
    } else {
        if (list.some(p => p.urut > 0)) {
            if (!confirm("⚠️ Kategori ini SUDAH DIUNDI.\nYakin ingin mengacak ulang?")) return;
            list.forEach(p => { p.scores = { b1: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 }, b2: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 } }; p.finalScore = 0; p.techScore = 0; });
        }
        shuffleArray(list);

        // --- LOGIKA PEMOTONG POOL DINAMIS (EMBU) ---
        let maxPerPool = (STATE.settings && STATE.settings.maxPesertaPoolEmbu) ? parseInt(STATE.settings.maxPesertaPoolEmbu) : 12;

        if (list.length > maxPerPool) {
            let numGroups = Math.ceil(list.length / maxPerPool);
            let baseSize = Math.floor(list.length / numGroups);
            let remainder = list.length % numGroups;
            let currentIndex = 0;
            const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

            for (let i = 0; i < numGroups; i++) {
                let groupSize = baseSize + (i < remainder ? 1 : 0);
                let poolName = alphabet[i] || `P${i + 1}`; // Anti-Bug: Jika alfabet habis
                let currentPool = list.slice(currentIndex, currentIndex + groupSize);
                applyDrawingData(currentPool, poolName);
                currentIndex += groupSize;
            }
        } else {
            applyDrawingData(list, 'SINGLE');
        }
    }
    saveToLocalStorage(); checkExistingDrawing(); renderParticipantTable();
}

function shuffleArray(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; } }
function applyDrawingData(arr, poolName) { arr.forEach((p, index) => { const found = STATE.participants.find(item => item.id === p.id); if (found) { found.urut = index + 1; found.pool = poolName; } }); }

// =========================================================
// MESIN PEMBACA JADWAL & PLAYLIST (SUPER OPTIMIZED)
// Menggunakan Array Buffer & Data Dictionary
// =========================================================
function renderJadwalList() {
    const container = document.getElementById('jadwal-container');
    const badge = document.getElementById('jadwal-court-badge');
    if (!container) return;

    let cIdx = -1;
    if (DEVICE_ROLE === 'court_1') cIdx = 0;
    else if (DEVICE_ROLE === 'court_2') cIdx = 1;
    else if (DEVICE_ROLE === 'court_3') cIdx = 2;

    if (cIdx === -1) {
        container.className = 'flex flex-col gap-3 w-full';
        if (badge) badge.innerText = "MODE ADMIN";
        container.innerHTML = '<div class="w-full text-center text-slate-500 py-10 border-2 border-dashed border-slate-700 rounded-xl"><i class="fas fa-user-shield text-4xl mb-3 opacity-30"></i><br>Anda menggunakan Mode Admin.<br>Ubah peran perangkat ke "Tatami/Court" di Tab Admin untuk melihat playlist jadwal di lapangan ini.</div>';
        return;
    }

    if (badge) badge.innerText = `COURT ${cIdx + 1}`;

    if (!STATE.rundown || STATE.rundown.length === 0) {
        container.className = 'flex flex-col gap-3 w-full';
        container.innerHTML = '<div class="w-full text-center text-slate-500 py-10 border-2 border-dashed border-slate-700 rounded-xl">Jadwal belum dibuat atau disinkronisasi oleh Pusat Komando (Admin).</div>';
        return;
    }

    // ========================================================
    // 🚀 OPTIMASI 1: DATA DICTIONARY (HASH MAP) & CACHING REGEX
    // Memori pintar agar sistem tidak bolak-balik mencari data
    // ========================================================
    const pById = {};
    STATE.participants.forEach(p => pById[p.id] = p);

    const matchesCache = STATE.matches.map(m => ({
        ...m,
        normKat: normStr(m.kategori)
    }));

    const partsCache = STATE.participants.map(p => ({
        ...p,
        normKat: normStr(p.kategori)
    }));

    // ========================================================
    // 🚀 OPTIMASI 2: ARRAY STRING BUILDER
    // Mengumpulkan elemen HTML di Array sebelum digambar sekaligus
    // ========================================================
    let htmlBuffer = [];
    let hasSchedule = false;

    STATE.rundown.forEach((daySchedule, dIdx) => {
        if (daySchedule[cIdx] && daySchedule[cIdx].length > 0) {

            htmlBuffer.push(`
                <div class="flex items-center gap-4 mt-6 mb-1 w-full">
                    <div class="bg-slate-800 text-white font-black px-4 py-1.5 rounded-md text-xs tracking-widest border-l-4 border-indigo-500 shadow-sm">HARI ${dIdx + 1}</div>
                    <div class="h-px bg-slate-800 flex-1"></div>
                </div>
            `);

            let urutanMain = 1;

            daySchedule[cIdx].forEach((blk, bIdx) => {
                if (blk.type === 'rest' || blk.type === 'ceremony') {
                    let iconClass = blk.type === 'rest' ? 'fa-mug-hot text-amber-500' : 'fa-flag text-pink-500';
                    let bgClass = blk.type === 'rest' ? 'bg-amber-900/10 border-amber-800/30' : 'bg-pink-900/10 border-pink-800/30';

                    htmlBuffer.push(`
                        <div class="${bgClass} border border-dashed rounded-xl p-3 md:p-4 flex flex-col md:flex-row md:items-center gap-3 md:gap-6 shadow-sm w-full">
                            <span class="font-mono text-xs font-bold text-slate-400 shrink-0 md:w-32"><i class="fas fa-clock mr-1.5 opacity-50"></i>${minsToTime(blk.startTime)} - ${minsToTime(blk.endTime)}</span>
                            <span class="text-sm font-bold uppercase tracking-widest text-slate-300 flex-1"><i class="fas ${iconClass} mr-2"></i>${blk.title}</span>
                            <span class="text-[10px] font-mono bg-slate-900 px-2 py-1 rounded text-slate-500 hidden md:block">Durasi: ${blk.endTime - blk.startTime} Menit</span>
                        </div>
                    `);
                    return;
                }

                hasSchedule = true;

                let isMatchSystem = blk.matchNums && blk.matchNums.length > 0;
                let isRandori = blk.type === 'randori';
                let badgeColor = isRandori ? 'bg-red-600' : (isMatchSystem ? 'bg-purple-600' : 'bg-emerald-600');

                let totalCount = 0;
                let doneCount = 0;
                let siapDimainkan = false;
                let accordionRowsBuffer = [];

                let normBlkCat = normStr(blk.catNameReal);
                let normBlkTitle = normStr(blk.title);

                // ========================================================
                // RENDER MATCH SYSTEM (RANDORI & EMBU H2H)
                // ========================================================
                if (isMatchSystem) {
                    totalCount = blk.matchNums.length;

                    let matches = [];
                    blk.matchNums.forEach(mNum => {
                        let found = matchesCache.find(x =>
                            (x.normKat === normBlkCat || x.normKat === normBlkTitle) &&
                            x.matchNum === mNum &&
                            (blk.pool ? x.pool === blk.pool : true)
                        );
                        if (found) matches.push(found);
                    });

                    siapDimainkan = matches.some(m => m.merahId != null && m.putihId != null);

                    matches.forEach(m => {
                        if (m.status === 'done' || m.status === 'completed' || m.status === 'auto-win') doneCount++;

                        let pMrh = pById[m.merahId];
                        let pPth = pById[m.putihId];
                        let displayNum = m.matchNum % 50 === 0 ? 50 : m.matchNum % 50;

                        const potongNama = (p) => p ? (p.nama.split(/\s+/).length > 2 ? p.nama.split(/\s+/).slice(0, 2).join(' ') + '...' : p.nama) : "Menunggu...";
                        const kontingen = (p) => p ? `(${p.kontingen})` : "";

                        const colorMrh = pMrh ? "text-red-400" : "text-slate-500";
                        const colorPth = pPth ? "text-white" : "text-slate-500";
                        const prefixG = isRandori ? "text-red-400" : "text-purple-400";

                        accordionRowsBuffer.push(`
                            <tr class="hover:bg-slate-800/30 transition-colors">
                                <td class="py-2.5 px-4 ${prefixG} font-mono font-bold w-16 text-center text-[10px]">G-${displayNum}</td>
                                <td class="py-2.5 px-4 leading-tight">
                                    <span class="${colorMrh} font-bold text-[11px]">${potongNama(pMrh)} <span class="text-[9px] font-normal opacity-70">${kontingen(pMrh)}</span></span>
                                    <span class="text-[9px] text-slate-600 italic mx-3 font-black">VS</span>
                                    <span class="${colorPth} font-bold text-[11px]">${potongNama(pPth)} <span class="text-[9px] font-normal opacity-70">${kontingen(pPth)}</span></span>
                                </td>
                            </tr>
                        `);
                    });

                    // ========================================================
                    // RENDER EMBU BAKU / FESTIVAL
                    // ========================================================
                } else if (blk.embuTrackers) {
                    totalCount = blk.embuTrackers.length;

                    let subtitleText = blk.subtitle || "";
                    let isEksibisi = subtitleText.includes('EKSIBISI');
                    let isFinal = subtitleText.includes('FINAL') && !isEksibisi;
                    let isBabak2 = subtitleText.includes('BABAK 2') && !isFinal && !isEksibisi;

                    let parts = [];
                    blk.embuTrackers.forEach(t => {
                        let found = partsCache.find(x =>
                            x.normKat === normBlkCat &&
                            (isFinal ? x.urutFinal === t.label : (isBabak2 ? x.urutB2 === t.label : x.urut === t.label)) &&
                            (blk.pool ? x.pool === blk.pool : true)
                        );
                        if (found) parts.push(found);
                    });

                    siapDimainkan = parts.length > 0;

                    blk.embuTrackers.forEach(t => {
                        let p = partsCache.find(x =>
                            x.normKat === normBlkCat &&
                            (isFinal ? x.urutFinal === t.label : (isBabak2 ? x.urutB2 === t.label : x.urut === t.label)) &&
                            (blk.pool ? x.pool === blk.pool : true)
                        );

                        if (p) {
                            let isFull = (isFinal || isBabak2) ? (p.scores?.b2?.final > 0) : (p.scores?.b1?.final > 0 || p.finalScore > 0 || p.calcFinal > 0);
                            if (isFull) doneCount++;

                            let names = p.nama.split(/[,+&]/).map(n => n.trim()).join(' & ');
                            accordionRowsBuffer.push(`
                                <tr class="hover:bg-slate-800/30 transition-colors">
                                    <td class="py-2.5 px-4 text-blue-400 font-mono font-bold w-16 text-center text-[10px]">No.${t.label}</td>
                                    <td class="py-2.5 px-4 leading-tight">
                                        <span class="font-bold text-slate-200 text-[11px] mr-2">${names}</span>
                                        <span class="text-[9px] text-yellow-500 font-bold uppercase">(${p.kontingen})</span>
                                    </td>
                                </tr>
                            `);
                        } else {
                            accordionRowsBuffer.push(`
                                <tr class="hover:bg-slate-800/30 transition-colors">
                                    <td class="py-2.5 px-4 text-blue-400 font-mono font-bold w-16 text-center text-[10px]">No.${t.label}</td>
                                    <td class="py-2.5 px-4 leading-tight text-slate-500 italic text-[11px]">Menunggu Atlet...</td>
                                </tr>
                            `);
                        }
                    });
                }

                let accordionRowsHTML = accordionRowsBuffer.length > 0
                    ? accordionRowsBuffer.join('')
                    : `<tr><td class="py-3 text-center text-slate-500 italic text-[10px]">Data peserta kosong.</td></tr>`;

                let btnHtml = '';
                if (totalCount === 0 || !siapDimainkan) {
                    btnHtml = `<button disabled class="bg-slate-800/50 border border-slate-700 text-slate-500 text-[10px] font-bold py-2.5 px-4 rounded-lg cursor-not-allowed flex items-center gap-2 whitespace-nowrap shadow-inner w-full md:w-auto justify-center"><i class="fas fa-user-clock"></i> MENUNGGU ATLET</button>`;
                } else if (doneCount >= totalCount) {
                    btnHtml = `<button disabled class="bg-emerald-900/20 border border-emerald-800/50 text-emerald-500 text-[10px] font-bold py-2.5 px-5 rounded-lg cursor-not-allowed flex items-center gap-2 whitespace-nowrap shadow-inner w-full md:w-auto justify-center"><i class="fas fa-check"></i> SELESAI</button>`;
                } else {
                    btnHtml = `<button onclick="playJadwalBlock(${dIdx}, ${cIdx}, ${bIdx})" class="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black tracking-widest py-2.5 px-6 rounded-lg shadow-md transition-transform hover:scale-105 flex items-center gap-2 whitespace-nowrap border border-indigo-500 w-full md:w-auto justify-center"><i class="fas fa-play"></i> PLAYLIST</button>`;
                }

                let isDone = totalCount > 0 && doneCount >= totalCount;
                let accId = `acc-${dIdx}-${cIdx}-${bIdx}`;

                htmlBuffer.push(`
                    <div class="bg-slate-900 border border-slate-700 rounded-xl shadow-sm transition-all hover:border-slate-500 flex flex-col relative overflow-hidden w-full ${isDone ? 'opacity-70' : ''}">
                        <div class="flex flex-col md:flex-row items-stretch">
                            <div class="md:w-40 p-4 flex flex-row md:flex-col items-center md:items-start justify-between md:justify-center border-b md:border-b-0 md:border-r border-slate-800 bg-slate-800/20 shrink-0">
                                <div class="text-slate-300 font-mono text-xs font-black mb-0 md:mb-1.5 flex items-center gap-2">
                                    <i class="fas fa-clock text-slate-500 hidden md:block"></i> ${minsToTime(blk.startTime)} - ${minsToTime(blk.endTime)}
                                </div>
                                <div class="text-[9px] font-black uppercase tracking-widest text-white px-2 py-0.5 rounded shadow-sm ${badgeColor}">${blk.type}</div>
                            </div>
                            <div class="flex-1 p-4 flex flex-col justify-center min-w-0">
                                <div class="flex items-start md:items-center gap-2 mb-1.5 flex-col md:flex-row">
                                    <span class="text-slate-500 font-black text-[10px] bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 shrink-0">#${urutanMain}</span>
                                    <h3 class="text-sm font-black text-white leading-tight truncate w-full" title="${blk.title}">${blk.title}</h3>
                                </div>
                                <div class="text-[10px] font-bold uppercase tracking-widest text-indigo-400 mb-3 truncate w-full" title="${blk.subtitle}">${blk.subtitle}</div>
                                
                                <div class="flex items-center gap-3 w-full max-w-sm">
                                    <div class="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden border border-slate-700/50">
                                        <div class="bg-indigo-500 h-full rounded-full transition-all duration-500" style="width: ${totalCount === 0 ? 0 : (doneCount / totalCount) * 100}%"></div>
                                    </div>
                                    <span class="text-[10px] font-bold font-mono shrink-0 ${isDone ? 'text-green-400' : 'text-slate-400'}">${doneCount}/${totalCount} Partai</span>
                                </div>
                            </div>
                            <div class="p-4 flex flex-col-reverse md:flex-row items-stretch md:items-center justify-end border-t md:border-t-0 md:border-l border-slate-800 shrink-0 gap-2 bg-slate-800/10">
                                ${btnHtml}
                                <button onclick="toggleJadwalAccordion('${accId}')" class="w-full md:w-9 h-9 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors flex items-center justify-center focus:outline-none" title="Lihat Daftar Atlet">
                                    <span class="text-[10px] font-bold md:hidden mr-2">LIHAT ATLET</span>
                                    <i id="icon-${accId}" class="fas fa-chevron-down text-xs transition-transform duration-300"></i>
                                </button>
                            </div>
                        </div>
                        <div id="${accId}" class="hidden bg-[#0a0f1c] border-t border-slate-800">
                            <div class="max-h-56 overflow-y-auto custom-scrollbar p-1">
                                <table class="w-full text-left text-xs table-fixed">
                                    <tbody class="divide-y divide-slate-800/50">
                                        ${accordionRowsHTML}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                `);

                urutanMain++;
            });
        }
    });

    // ========================================================
    // 🚀 OPTIMASI 3: BULK DOM MANIPULATION (Cetak 1 Kali!)
    // ========================================================
    container.className = 'flex flex-col gap-3 w-full';

    if (!hasSchedule) {
        container.innerHTML = '<div class="w-full text-center text-slate-500 py-10 border-2 border-dashed border-slate-700 rounded-xl">Tidak ada blok pertandingan untuk lapangan ini di Jadwal.</div>';
    } else {
        container.innerHTML = htmlBuffer.join('');
    }
}

// ==========================================
// FUNGSI ANIMASI ACCORDION JADWAL MINIMALIS
// ==========================================
function toggleJadwalAccordion(accId) {
    const content = document.getElementById(accId);
    const icon = document.getElementById(`icon-${accId}`);

    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        icon.style.transform = 'rotate(180deg)';
        icon.parentElement.classList.add('bg-slate-700', 'text-white');
    } else {
        content.classList.add('hidden');
        icon.style.transform = 'rotate(0deg)';
        icon.parentElement.classList.remove('bg-slate-700', 'text-white');
    }
}

function playJadwalBlock(dIdx, cIdx, bIdx) {
    let queue = STATE.rundown[dIdx][cIdx];
    if (!queue || !queue[bIdx]) return;

    let blk = queue[bIdx];

    // Otomatis lompat jika itu jam istirahat / upacara
    if (blk.type === 'rest' || blk.type === 'ceremony') {
        if (bIdx + 1 < queue.length) {
            return playJadwalBlock(dIdx, cIdx, bIdx + 1);
        } else {
            alert("Seluruh jadwal di lapangan ini untuk hari ini telah selesai!");
            return;
        }
    }

    // Set Memori Playlist Aktif
    ACTIVE_PLAYLIST = { isActive: true, block: blk, dIdx: dIdx, cIdx: cIdx, bIdx: bIdx };

    // 🔥 AUTO-STANDBY & SAPU BERSIH JURI SAAT GANTI BLOK JADWAL
    const safeCourtId = typeof DEVICE_ROLE !== 'undefined' && DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';
    isWasitDigitalMode = false;
    const btnWasit = document.getElementById('btnTembakWasit');
    if (btnWasit) {
        btnWasit.className = "w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 px-4 rounded-xl shadow-md mt-3 transition-all border border-slate-600";
        btnWasit.innerHTML = '<i class="fas fa-power-off mr-2"></i> AKTIFKAN KONEKSI HP WASIT';
    }

    if (database) {
        database.ref(`live_embu/${safeCourtId}/juri`).set(null).catch(e => console.warn(e));
        database.ref(`live_embu/${safeCourtId}`).update({ status: 'standby' }).catch(e => console.warn(e));
    }
    if (typeof localSocket !== 'undefined' && localSocket) {
        localSocket.emit('broadcast_to_tv', {
            channel: 'lokal_panitera',
            court: safeCourtId,
            payload: { status: 'standby', action: 'clear_juri' }
        });
    }

    // Paksa sinkron Kategori
    let catSelect = document.getElementById('select-kategori');
    if (catSelect) {
        let matchedCat = Array.from(catSelect.options).find(opt => normStr(opt.value) === normStr(blk.catNameReal));
        if (matchedCat) catSelect.value = matchedCat.value;
    }

    switchTab('scoring');
    filterPesertaScoring();
    document.getElementById('playlist-next-block-zone').classList.add('hidden');

    // =========================================================
    // SUNTIKAN BARU: PANGGIL ACCORDION PERSIAPAN BLOK SELANJUTNYA
    // =========================================================
    renderNextBlockPreview(dIdx, cIdx, bIdx);

    // Tembak partai pertama secara otomatis
    setTimeout(() => { autoNextPlaylistMatch(); }, 200);
}

function renderNextBlockPreview(currentDayIdx, currentCourtIdx, currentBlockIdx) {
    const zoneOnDeck = document.getElementById('zone-on-deck');
    const accNext = document.getElementById('accordion-next-block');

    const currentTbody = document.getElementById('current-block-participants');
    const nextTbody = document.getElementById('next-block-participants');

    if (!STATE || !STATE.rundown || !STATE.rundown[currentDayIdx] || !STATE.rundown[currentDayIdx][currentCourtIdx]) {
        if (zoneOnDeck) zoneOnDeck.classList.add('hidden');
        return;
    }

    const blocks = STATE.rundown[currentDayIdx][currentCourtIdx];
    const currentBlock = blocks[currentBlockIdx];

    if (!currentBlock) {
        if (zoneOnDeck) zoneOnDeck.classList.add('hidden');
        return;
    }

    if (zoneOnDeck) zoneOnDeck.classList.remove('hidden');

    // 1. RENDER BLOK SAAT INI (Accordion 1)
    document.getElementById('current-block-title').innerText = currentBlock.title || "-";
    let currSub = currentBlock.subtitle || "";
    document.getElementById('current-block-subtitle').innerText = "BLOK SAAT INI " + (currSub ? `• ${currSub}` : "");
    currentTbody.innerHTML = generateRowsForBlock(currentBlock);

    // 2. RENDER BLOK SELANJUTNYA (Accordion 2)
    const nextBlockIndex = currentBlockIdx + 1;
    let nextBlock = null;

    for (let i = nextBlockIndex; i < blocks.length; i++) {
        if (blocks[i].type !== 'rest' && blocks[i].type !== 'ceremony') {
            nextBlock = blocks[i];
            break;
        }
    }

    if (nextBlock) {
        accNext.classList.remove('hidden');
        document.getElementById('next-block-title').innerText = nextBlock.title || "-";
        document.getElementById('next-block-subtitle').innerText = "PERSIAPAN BLOK SELANJUTNYA " + (nextBlock.subtitle ? `• ${nextBlock.subtitle}` : "");
        nextTbody.innerHTML = generateRowsForBlock(nextBlock);
    } else {
        accNext.classList.add('hidden');
    }
}

// FUNGSI PEMBANTU: Mencetak baris tabel (Mendukung Randori, Embu H2H, & Embu Baku)
function generateRowsForBlock(blockData) {
    let html = '';

    // RENDER MATCH SYSTEM (RANDORI ATAU EMBU H2H)
    if (blockData.matchNums && blockData.matchNums.length > 0) {
        let isRandori = blockData.type === 'randori';
        let prefixColorClass = isRandori ? "text-red-400" : "text-purple-400";

        blockData.matchNums.forEach(mNum => {
            let m = STATE.matches.find(x =>
                (normStr(x.kategori) === normStr(blockData.catNameReal) || normStr(x.kategori) === normStr(blockData.title)) &&
                x.matchNum === mNum &&
                (blockData.pool ? x.pool === blockData.pool : true)
            );

            if (m) {
                let pMrh = STATE.participants.find(p => p.id === m.merahId);
                let pPth = STATE.participants.find(p => p.id === m.putihId);
                let displayNum = m.matchNum % 50 === 0 ? 50 : m.matchNum % 50;

                const potongNama = (nama) => {
                    let kata = (nama || "").trim().split(/\s+/);
                    return kata.length > 3 ? kata.slice(0, 3).join(' ') + ' (...)' : nama;
                };

                let colorMrh = pMrh ? "text-red-400" : "text-slate-500";
                let colorPth = pPth ? "text-white" : "text-slate-500";

                let nMrhRaw = pMrh ? potongNama(pMrh.nama) : "Menunggu";
                let nPthRaw = pPth ? potongNama(pPth.nama) : "Menunggu";
                let kMrhRaw = pMrh ? pMrh.kontingen : "-";
                let kPthRaw = pPth ? pPth.kontingen : "-";

                // 🔥 TAMPILAN BERSIH TANPA CORETAN
                html += `
                    <tr class="transition-colors hover:bg-slate-800/50">
                        <td class="p-3 text-center font-mono font-bold ${prefixColorClass} bg-slate-900/30">G-${displayNum}</td>
                        <td class="p-3 font-bold whitespace-nowrap">
                            <span class="${colorMrh}">${kMrhRaw}</span> 
                            <span class="text-slate-500 text-[11px] mx-2 italic font-normal">VS</span> 
                            <span class="${colorPth}">${kPthRaw}</span>
                        </td>
                        <td class="p-3 border-l border-slate-800 leading-tight whitespace-nowrap">
                            <span class="${colorMrh}">${nMrhRaw}</span> 
                            <span class="text-slate-500 text-[11px] mx-2 italic">VS</span> 
                            <span class="${colorPth}">${nPthRaw}</span>
                        </td>
                    </tr>`;
            }
        });

        // RENDER EMBU BAKU / FESTIVAL
    } else if (blockData.embuTrackers) {
        let babakType = blockData.babak || 'b1';
        let isEksibisi = blockData.isEksibisi === true;

        blockData.embuTrackers.forEach(t => {
            let p = STATE.participants.find(x =>
                x.kategori === blockData.catNameReal &&
                ((babakType === 'final' && !isEksibisi) ? x.urutFinal === t.label : (babakType === 'b2' ? x.urutB2 === t.label : x.urut === t.label)) &&
                (blockData.pool ? x.pool === blockData.pool : true)
            );

            if (p) {
                let names = p.nama.split(/[,+&]/).map(n => n.trim()).join(' & ');
                // 🔥 TAMPILAN BERSIH TANPA CORETAN
                html += `
                    <tr class="transition-colors hover:bg-slate-800/50">
                        <td class="p-3 text-center font-mono font-bold text-blue-400 bg-slate-900/30">No.${t.label}</td>
                        <td class="p-3 font-bold text-yellow-500">${p.kontingen}</td>
                        <td class="p-3 border-l border-slate-800 leading-tight">${names}</td>
                    </tr>`;
            }
        });
    }

    if (html === '') return `<tr><td colspan="3" class="p-4 text-center text-slate-500 italic">Belum ada data peserta di blok ini.</td></tr>`;
    return html;
}

function toggleCurrentBlockAccordion() {
    const content = document.getElementById('accordion-content-current');
    const icon = document.getElementById('accordion-icon-current');

    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        icon.style.transform = 'rotate(180deg)';
    } else {
        content.classList.add('hidden');
        icon.style.transform = 'rotate(0deg)';
    }
}

function toggleNextBlockAccordion() {
    const content = document.getElementById('accordion-content-next');
    const icon = document.getElementById('accordion-icon-next');

    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        icon.style.transform = 'rotate(180deg)';
    } else {
        content.classList.add('hidden');
        icon.style.transform = 'rotate(0deg)';
    }
}

function autoNextPlaylistMatch() {
    if (!ACTIVE_PLAYLIST.isActive || !ACTIVE_PLAYLIST.block) return;

    let selectDropdown = document.getElementById('select-peserta');
    if (!selectDropdown) return;

    let foundNext = false;

    // Loop opsi dari atas ke bawah, cari partai pertama yang belum selesai
    for (let i = 0; i < selectDropdown.options.length; i++) {
        let opt = selectDropdown.options[i];
        let val = opt.value;
        if (!val) continue;

        let isDone = false;
        let isValid = true;

        if (val.startsWith('match-')) { // Randori Murni
            let mId = parseInt(val.replace('match-', ''));
            let match = STATE.matches.find(m => m.id === mId);
            if (match) {
                if (match.status === 'done' || match.status === 'completed' || match.status === 'auto-win') isDone = true;
                if (match.merahId === null || match.putihId === null || match.merahId === -1 || match.putihId === -1) isValid = false; // Skip Hantu
            }
        } else if (val.startsWith('h2h-match-')) { // 🌟 PERBAIKAN: Deteksi Playlist Embu H2H
            const parts = val.split('-');
            const matchId = parseInt(parts[2]);
            const corner = parts[3]; // bernilai 'merah' atau 'putih'
            const match = STATE.matches.find(m => m.id === matchId);

            if (match) {
                // Cek apakah sudut ini sudah selesai dinilai
                if (corner === 'merah' && match.skorMerah > 0) isDone = true;
                if (corner === 'putih' && match.skorPutih > 0) isDone = true;

                // Lewati (tidak valid) jika slot tidak ada orang (Null/Hantu)
                if (match.merahId === null || match.putihId === null || match.merahId === -1 || match.putihId === -1) isValid = false;
            }
        } else if (val.includes('|')) { // Embu Baku / Festival
            let [pIdStr, babak] = val.split('|');
            let p = STATE.participants.find(x => x.id === parseInt(pIdStr));
            if (p) {
                if (babak === 'b1' && p.scores.b1.final > 0) isDone = true;
                if (babak === 'b2' && p.scores.b2.final > 0) isDone = true;
            }
        }

        if (!isDone && isValid) {
            // EKSEKUSI! Ditemukan partai yang pending
            selectDropdown.selectedIndex = i;
            const event = new Event('change');
            selectDropdown.dispatchEvent(event);

            document.getElementById('playlist-next-block-zone').classList.add('hidden');
            foundNext = true;
            break;
        }
    }

    if (!foundNext) {
        // SELURUH PARTAI DI BLOK INI SELESAI
        document.getElementById('panel-embu').classList.add('hidden');
        document.getElementById('panel-randori').classList.add('hidden');

        let topAction = document.getElementById('top-action-randori');
        if (topAction) topAction.classList.add('hidden');

        let gridEl = document.getElementById('scoring-athlete-grid');
        if (gridEl) gridEl.classList.add('hidden');

        document.getElementById('scoring-athlete-name').innerText = "MENUNGGU BLOK SELANJUTNYA...";
        document.getElementById('playlist-next-block-zone').classList.remove('hidden');

        // 🔥 TV TIDAK DIPAKSA MATI OTOMATIS
        // Layar TV tetap aman menayangkan hasil nilai/juara partai terakhir
        // sampai panitera menekan "Lanjut Blok" atau mematikan tombol TV secara manual.
    }
}

function playNextJadwalBlock() {
    let dIdx = ACTIVE_PLAYLIST.dIdx;
    let cIdx = ACTIVE_PLAYLIST.cIdx;
    let bIdx = ACTIVE_PLAYLIST.bIdx;
    let queue = STATE.rundown[dIdx][cIdx];

    if (bIdx + 1 < queue.length) {
        playJadwalBlock(dIdx, cIdx, bIdx + 1);
    } else {
        alert("Jadwal di lapangan ini untuk hari ini telah selesai!");
        closePlaylist();
        switchTab('jadwal');
    }
}

function closePlaylist() {
    ACTIVE_PLAYLIST.isActive = false;

    const banner = document.getElementById('playlist-banner');
    const nextBlockZone = document.getElementById('playlist-next-block-zone');
    const kategoriZone = document.getElementById('manual-kategori-zone');
    const zoneOnDeck = document.getElementById('zone-on-deck')

    if (banner) banner.classList.add('hidden');
    if (nextBlockZone) nextBlockZone.classList.add('hidden');
    if (kategoriZone) kategoriZone.classList.remove('hidden');
    if (zoneOnDeck) zoneOnDeck.classList.add('hidden');

    // 🌟 SUNTIKAN RESET: Pastikan layar tidak tertinggal dalam kondisi "Blank"
    let pEmbu = document.getElementById('panel-embu');
    let pRandori = document.getElementById('panel-randori');
    if (pEmbu) pEmbu.classList.add('hidden'); // <-- Ubah di sini
    if (pRandori) pRandori.classList.add('hidden'); // <-- Ubah di sini
    document.getElementById('scoring-athlete-name').innerText = "-"; // Reset judul

    filterPesertaScoring();
    switchTab('jadwal');
}

// LOGIKA MANUAL: Tombol "Lanjut Partai Berikutnya"
function nextPlaylistItem() {
    let selectDropdown = document.getElementById('select-peserta');
    if (!selectDropdown) return;

    let currentIndex = selectDropdown.selectedIndex;
    if (currentIndex < selectDropdown.options.length - 1) {
        // Pindahkan kursor turun satu ke bawah
        selectDropdown.selectedIndex = currentIndex + 1;
        // PENTING: Pancing event onChange agar logika tampilan (timer, nama merah putih) berubah
        const event = new Event('change');
        selectDropdown.dispatchEvent(event);
    } else {
        alert("🎉 Playlist Selesai! Semua partai di blok ini sudah dituntaskan.");
        closePlaylist();
        switchTab('jadwal');
    }
}

let HOLD_H2H_SCREEN = false;

function filterPesertaScoring() {
    // 🛑 PORTAL PENCEGAT: Jika gembok aktif, abaikan gempuran refresh dari Firebase!
    if (HOLD_H2H_SCREEN) return;
    const catName = document.getElementById('select-kategori').value;
    const categoryObj = STATE.categories.find(c => c.name === catName);
    const selectEl = document.getElementById('select-peserta');

    // UI Elements
    const panelEmbu = document.getElementById('panel-embu');
    const panelRandori = document.getElementById('panel-randori');
    const badgeEmbu = document.getElementById('scoring-badge-embu');
    const badgeRandori = document.getElementById('scoring-badge-randori');
    const panelWaktu = document.getElementById('panel-waktu-embu');
    const panelJuri = document.getElementById('panel-juri-embu');
    const topActionRandori = document.getElementById('top-action-randori');

    const kategoriZone = document.getElementById('manual-kategori-zone');
    const banner = document.getElementById('playlist-banner');
    const titleEl = document.getElementById('playlist-title');
    const timeEl = document.getElementById('playlist-time');
    const nextBlockZone = document.getElementById('playlist-next-block-zone');

    if (ACTIVE_PLAYLIST.isActive && ACTIVE_PLAYLIST.block) {
        let currentCat = document.getElementById('select-kategori').value;

        if (normStr(currentCat) !== normStr(ACTIVE_PLAYLIST.block.catNameReal)) {
            ACTIVE_PLAYLIST.isActive = false;
            if (banner) banner.classList.add('hidden');
            if (kategoriZone) kategoriZone.classList.remove('hidden');
        } else {
            if (kategoriZone) kategoriZone.classList.add('hidden');
            if (banner) {
                banner.classList.remove('hidden');
                titleEl.innerText = `${ACTIVE_PLAYLIST.block.title} (${ACTIVE_PLAYLIST.block.subtitle})`;
                timeEl.innerText = `Estimasi Waktu: ${minsToTime(ACTIVE_PLAYLIST.block.startTime)} - ${minsToTime(ACTIVE_PLAYLIST.block.endTime)}`;
            }
        }
    } else {
        if (kategoriZone) kategoriZone.classList.remove('hidden');
        if (banner) banner.classList.add('hidden');
        if (nextBlockZone) nextBlockZone.classList.add('hidden');
    }

    for (let i = 1; i <= 5; i++) {
        let stempel = document.getElementById(`stempelJuri${i}`);
        let btnReset = document.getElementById(`btnReset${i}`);
        if (stempel) stempel.classList.add('hidden');
        if (btnReset) btnReset.classList.add('hidden');

        let scoreInput = document.getElementById(`score-${i}`);
        let techInput = document.getElementById(`tech-${i}`);
        if (scoreInput) scoreInput.removeAttribute('readonly');
        if (techInput) techInput.removeAttribute('readonly');
    }

    if (!categoryObj) return;

    const currentSelectedMatchOrAthlete = selectEl.value;

    let isEmbuH2H = categoryObj && categoryObj.discipline === 'embu' && STATE.settings && STATE.settings.embuFormat === 'h2h';

    if (categoryObj.discipline === 'randori') {
        panelEmbu.classList.add('hidden'); panelRandori.classList.remove('hidden');
        badgeEmbu.classList.add('hidden'); badgeRandori.classList.remove('hidden');
        if (panelWaktu) panelWaktu.classList.add('hidden');
        if (panelJuri) panelJuri.classList.add('hidden');
        if (topActionRandori) topActionRandori.classList.remove('hidden');

        let gridEl = document.getElementById('scoring-athlete-grid');
        if (gridEl) gridEl.className = 'hidden';

        let catMatches = STATE.matches.filter(m =>
            m.kategori === catName &&
            m.status === 'pending' &&
            m.merahId != null && m.putihId != null &&
            m.merahId !== -1 && m.putihId !== -1
        );

        if (ACTIVE_PLAYLIST.isActive) {
            let blk = ACTIVE_PLAYLIST.block;
            catMatches = catMatches.filter(m => blk.matchNums.includes(m.matchNum) && (blk.pool ? m.pool === blk.pool : true));
        }

        if (catMatches.length === 0) {
            selectEl.innerHTML = `<option value="">-- Tidak ada Partai Aktif --</option>`;
            document.getElementById('scoring-athlete-name').innerText = "-";
            document.getElementById('randori-nama-merah').innerText = "-";
            document.getElementById('randori-kont-merah').innerText = "-";
            document.getElementById('randori-nama-putih').innerText = "-";
            document.getElementById('randori-kont-putih').innerText = "-";
            currentRandoriMatchId = null;
            resetRandoriBoard();
            return;
        }

        selectEl.innerHTML = catMatches.sort((a, b) => a.matchNum - b.matchNum).map((m) => {
            const mrh = STATE.participants.find(p => p.id === m.merahId) || { nama: "Menunggu..." };
            const pth = STATE.participants.find(p => p.id === m.putihId) || { nama: "Menunggu..." };
            let displayNum = m.matchNum % 50 === 0 ? 50 : m.matchNum % 50;
            let pLabel = m.pool !== '-' ? `Pool ${m.pool}` : 'Utama';
            return `<option value="match-${m.id}">G-${displayNum} [${pLabel}] [${m.babak}] ${mrh.nama} vs ${pth.nama}</option>`;
        }).join('');

    } else if (isEmbuH2H) {
        // ==========================================
        // HYBRID: MODE EMBU DOUBLE ELIMINATION (H2H)
        // ==========================================
        panelEmbu.classList.remove('hidden'); panelRandori.classList.add('hidden');
        badgeEmbu.classList.remove('hidden'); badgeRandori.classList.add('hidden');
        if (panelWaktu) panelWaktu.classList.remove('hidden');
        if (panelJuri) panelJuri.classList.remove('hidden');
        if (topActionRandori) topActionRandori.classList.add('hidden');

        badgeEmbu.innerText = "EMBU (H2H)";
        badgeEmbu.className = "bg-purple-600 text-white text-[10px] px-2 py-0.5 rounded font-bold tracking-widest";

        let gridEl = document.getElementById('scoring-athlete-grid');
        if (gridEl) gridEl.className = 'hidden';

        let catMatches = STATE.matches.filter(m =>
            m.kategori === catName && m.status === 'pending' &&
            m.merahId != null && m.putihId != null &&
            m.merahId !== -1 && m.putihId !== -1
        );

        if (ACTIVE_PLAYLIST.isActive) {
            let blk = ACTIVE_PLAYLIST.block;
            catMatches = catMatches.filter(m => blk.matchNums.includes(m.matchNum) && (blk.pool ? m.pool === blk.pool : true));
        }

        if (catMatches.length === 0) {
            selectEl.innerHTML = `<option value="">-- Tidak ada Partai Aktif --</option>`;
            document.getElementById('scoring-athlete-name').innerText = "-";
            updateScoringButtonsUI();
            return;
        }

        let optionsHTML = '';
        catMatches.sort((a, b) => a.matchNum - b.matchNum).forEach((m) => {
            const mrh = STATE.participants.find(p => p.id === m.merahId) || { nama: "Menunggu..." };
            const pth = STATE.participants.find(p => p.id === m.putihId) || { nama: "Menunggu..." };
            let displayNum = m.matchNum % 50 === 0 ? 50 : m.matchNum % 50;
            let pLabel = m.pool !== '-' ? `Pool ${m.pool}` : 'Utama';

            optionsHTML += `<optgroup label="Partai G-${displayNum} [${pLabel}] [${m.babak}]">`;

            // Masukkan Pita Merah (Buka gembok agar bisa direvisi sebelum pertandingan usai)
            if (!m.skorMerah || m.skorMerah === 0) {
                optionsHTML += `<option value="h2h-match-${m.id}-merah-${m.merahId}">PITA MERAH: ${mrh.nama} (${mrh.kontingen})</option>`;
            } else {
                // HAPUS 'disabled', tambahkan label visual [TERSIMPAN] dan nilai lama
                optionsHTML += `<option value="h2h-match-${m.id}-merah-${m.merahId}">[TERSIMPAN] PITA MERAH: ${mrh.nama} (Nilai: ${m.skorMerah}) - Revisi</option>`;
            }

            // Masukkan Pita Putih (Buka gembok agar bisa direvisi sebelum pertandingan usai)
            if (!m.skorPutih || m.skorPutih === 0) {
                optionsHTML += `<option value="h2h-match-${m.id}-putih-${m.putihId}">PITA PUTIH: ${pth.nama} (${pth.kontingen})</option>`;
            } else {
                // HAPUS 'disabled', tambahkan label visual [TERSIMPAN] dan nilai lama
                optionsHTML += `<option value="h2h-match-${m.id}-putih-${m.putihId}">[TERSIMPAN] PITA PUTIH: ${pth.nama} (Nilai: ${m.skorPutih}) - Revisi</option>`;
            }

            optionsHTML += `</optgroup>`;
        });

        selectEl.innerHTML = optionsHTML;
    } else {
        panelEmbu.classList.remove('hidden'); panelRandori.classList.add('hidden');
        badgeEmbu.classList.remove('hidden'); badgeRandori.classList.add('hidden');
        if (panelWaktu) panelWaktu.classList.remove('hidden');
        if (panelJuri) panelJuri.classList.remove('hidden');
        if (topActionRandori) topActionRandori.classList.add('hidden');

        if (categoryObj.discipline === 'festival') {
            badgeEmbu.innerText = "FESTIVAL";
            badgeEmbu.className = "bg-green-600 text-white text-[10px] px-2 py-0.5 rounded font-bold tracking-widest";
        } else {
            badgeEmbu.innerText = "EMBU";
            badgeEmbu.className = "bg-blue-600 text-white text-[10px] px-2 py-0.5 rounded font-bold tracking-widest";
        }

        let listCat = STATE.participants.filter(p => p.kategori === catName && p.urut > 0);

        if (ACTIVE_PLAYLIST.isActive) {
            let blk = ACTIVE_PLAYLIST.block;
            let validLabels = blk.embuTrackers ? blk.embuTrackers.map(t => t.label) : [];
            let babakType = blk.babak || 'b1';
            let isEksibisi = blk.isEksibisi === true;

            listCat = listCat.filter(p => {
                // PERBAIKAN: isEksibisi mutlak menggunakan p.urut
                let u = (babakType === 'final' && !isEksibisi) ? p.urutFinal : (babakType === 'b2' ? p.urutB2 : p.urut);
                return validLabels.includes(u) && (blk.pool ? p.pool === blk.pool : true);
            });
        }

        if (listCat.length === 0) {
            selectEl.innerHTML = `<option value="">-- Kosong / Belum Undian --</option>`;
            document.getElementById('scoring-athlete-name').innerText = "-";
            updateScoringButtonsUI();
            return;
        }

        let optionsHTML = '';

        if (categoryObj.discipline === 'festival') {
            let unikPools = [...new Set(listCat.map(p => p.pool))].sort();
            unikPools.forEach(pKey => {
                let anggotaKelompok = listCat.filter(p => p.pool === pKey).sort((a, b) => a.urut - b.urut);
                if (anggotaKelompok.length > 0) {
                    optionsHTML += `<optgroup label="--- KELOMPOK ${pKey} ---">`;
                    optionsHTML += anggotaKelompok.map(p => `<option value="${p.id}|b1">[Kelompok ${pKey}] No.${p.urut} - ${p.nama} (${p.kontingen})</option>`).join('');
                    optionsHTML += `</optgroup>`;
                }
            });
        } else {
            const hasFinal = listCat.some(p => p.isFinalist);

            if (hasFinal) {
                let finalL = listCat.filter(p => p.isFinalist).sort((a, b) => a.urutFinal - b.urutFinal);
                optionsHTML = finalL.map(p => `<option value="${p.id}|b2">[FINAL] No.${p.urutFinal} - ${p.nama} (${p.kontingen})</option>`).join('');
            } else if (listCat.some(p => p.pool !== 'SINGLE' && p.pool !== '-')) {
                let sorted = listCat.sort((a, b) => a.pool.localeCompare(b.pool) || a.urut - b.urut);
                optionsHTML = sorted.map(p => `<option value="${p.id}|b1">[Pool ${p.pool}] No.${p.urut} - ${p.nama} (${p.kontingen})</option>`).join('');
            } else {
                let minPeserta = (STATE.settings && STATE.settings.minPesertaJuara) ? parseInt(STATE.settings.minPesertaJuara) : 1;
                let isEksibisi = (listCat.length > 0 && listCat.length < minPeserta && STATE.settings && STATE.settings.eksibisiLangsungFinal === true);

                let sortedB1 = [...listCat].sort((a, b) => a.urut - b.urut);

                optionsHTML += `<optgroup label="--- TAMPIL PERTAMA (BABAK 1) ---">`;
                optionsHTML += sortedB1.map(p => `<option value="${p.id}|b1">[Babak 1] No.${p.urut} - ${p.nama} (${p.kontingen})</option>`).join('');
                optionsHTML += `</optgroup>`;

                if (isEksibisi) {
                    optionsHTML += `<optgroup label="--- TAMPIL KEDUA (BYPASS EKSIBISI 1 BABAK) ---">`;
                    optionsHTML += `<option disabled value="">Peserta < Min. Juara. Langsung Final dari B1.</option>`;
                    optionsHTML += `</optgroup>`;
                } else {
                    let modeB2 = (STATE.settings && STATE.settings.embuB2Mode) ? STATE.settings.embuB2Mode : 'reverse';
                    if (modeB2 === 'redraw') {
                        let sortedB2 = [...listCat].filter(p => p.urutB2 > 0).sort((a, b) => a.urutB2 - b.urutB2);
                        if (sortedB2.length > 0) {
                            optionsHTML += `<optgroup label="--- TAMPIL KEDUA (BABAK 2 : DIACAK ULANG) ---">`;
                            optionsHTML += sortedB2.map(p => `<option value="${p.id}|b2">[Babak 2] No.${p.urutB2} - ${p.nama} (${p.kontingen})</option>`).join('');
                            optionsHTML += `</optgroup>`;
                        } else {
                            optionsHTML += `<optgroup label="--- TAMPIL KEDUA (BABAK 2 : BELUM DIACAK) ---"></optgroup>`;
                        }
                    } else if (modeB2 === 'highscore') {
                        let sortedB2 = [...listCat].filter(p => p.scores.b1.final > 0).sort((a, b) => a.scores.b1.final - b.scores.b1.final || a.scores.b1.tech - b.scores.b1.tech);
                        if (sortedB2.length > 0) {
                            optionsHTML += `<optgroup label="--- TAMPIL KEDUA (BABAK 2 : NILAI B1 TERTINGGI TAMPIL TERAKHIR) ---">`;
                            optionsHTML += sortedB2.map((p, i) => `<option value="${p.id}|b2">[Babak 2] No.${i + 1} - ${p.nama} (B1: ${p.scores.b1.final})</option>`).join('');
                            optionsHTML += `</optgroup>`;
                        } else {
                            optionsHTML += `<optgroup label="--- TAMPIL KEDUA (BABAK 2 : SELESAIKAN BABAK 1 DULU) ---"></optgroup>`;
                        }
                    } else {
                        let sortedB2 = [...listCat].sort((a, b) => b.urut - a.urut);
                        optionsHTML += `<optgroup label="--- TAMPIL KEDUA (BABAK 2 : URUTAN DIBALIK) ---">`;
                        optionsHTML += sortedB2.map((p, i) => `<option value="${p.id}|b2">[Babak 2] No.${i + 1} - ${p.nama} (${p.kontingen})</option>`).join('');
                        optionsHTML += `</optgroup>`;
                    }
                }
            }
        }

        selectEl.innerHTML = optionsHTML;
    }

    let stillExists = Array.from(selectEl.options).some(opt => opt.value === currentSelectedMatchOrAthlete);
    if (stillExists) {
        selectEl.value = currentSelectedMatchOrAthlete;

        // 👇 KUNCI PERBAIKAN FIX RACE CONDITION 👇
        // Panggil ulang mesin penggambar UI agar "Badge Nama" kembali muncul
        // setelah layar disapu bersih oleh sinyal refresh dari database lokal/Socket
        if (categoryObj && categoryObj.discipline !== 'randori') {
            updateScoringButtonsUI();
        }
        // 👆 AKHIR PERBAIKAN 👆

    } else {
        if (selectEl.options.length > 0) {
            selectEl.value = selectEl.options[0].value;
            if (categoryObj.discipline === 'randori') {
                document.getElementById('scoring-athlete-name').innerText = selectEl.options[0].text;
                loadRandoriMatch();
            } else {
                document.getElementById('scoring-athlete-name').innerText = selectEl.options[selectEl.selectedIndex].text;
                updateScoringButtonsUI();
            }
        }
    }

    if (ACTIVE_PLAYLIST.isActive && categoryObj && categoryObj.discipline !== 'randori') {
        let blk = ACTIVE_PLAYLIST.block;
        let allowedBabak = 'b1';
        if (categoryObj.discipline === 'embu') {
            // PERBAIKAN: Pastikan isEksibisi tidak mengarah ke b2
            allowedBabak = (blk.babak === 'b2' || (blk.babak === 'final' && !blk.isEksibisi)) ? 'b2' : 'b1';
        }

        for (let i = selectEl.options.length - 1; i >= 0; i--) {
            let opt = selectEl.options[i];
            let val = opt.value;

            if (val) {
                if (val.includes('|') && !val.endsWith(`|${allowedBabak}`)) {
                    selectEl.remove(i);
                }
            } else {
                if (categoryObj.discipline === 'embu') {
                    let text = opt.text.toUpperCase();
                    if (allowedBabak === 'b1' && (text.includes('BABAK 2') || text.includes('KEDUA'))) {
                        selectEl.remove(i);
                    } else if (allowedBabak === 'b2' && (text.includes('BABAK 1') || text.includes('PERTAMA'))) {
                        selectEl.remove(i);
                    }
                }
            }
        }
    }
}

let currentRandoriMatchId = null;

function loadRandoriMatch() {
    const val = document.getElementById('select-peserta').value;
    if (!val || !val.startsWith('match-')) return;

    let gridEl = document.getElementById('scoring-athlete-grid');
    if (gridEl) gridEl.className = 'hidden';

    const newMatchId = parseInt(val.replace('match-', ''));
    if (currentRandoriMatchId === newMatchId) return;

    currentRandoriMatchId = newMatchId;
    const match = STATE.matches.find(m => m.id === currentRandoriMatchId);
    if (!match) return;

    const merah = STATE.participants.find(p => p.id === match.merahId);
    const putih = STATE.participants.find(p => p.id === match.putihId);

    // 1. Tampilkan Identitas Atlet
    document.getElementById('randori-nama-merah').innerText = merah ? merah.nama : "-";
    document.getElementById('randori-kont-merah').innerText = merah ? merah.kontingen : "-";
    document.getElementById('randori-nama-putih').innerText = putih ? putih.nama : "-";
    document.getElementById('randori-kont-putih').innerText = putih ? putih.kontingen : "-";

    // 2. Reset Papan Skor
    resetRandoriBoard();

    // 3. Deteksi Status Sanksi pada Kedua Sudut
    const isMerahBlocked = checkAthleteSanctionBlocked(merah, match.kategori);
    const isPutihBlocked = checkAthleteSanctionBlocked(putih, match.kategori);

    // 4. Render Tirai Gembok Sanksi
    renderCornerSanctionUI('merah', isMerahBlocked, merah ? merah.sanksiDetail : null);
    renderCornerSanctionUI('putih', isPutihBlocked, putih ? putih.sanksiDetail : null);

    // 5. Eksekusi Skor Otomatis Berdasarkan Status Sanksi
    if (isMerahBlocked && isPutihBlocked) {
        // Kasus Khusus: Kedua Atlet Membawa Sanksi Batsu (Double Diskualifikasi)
        RANDORI_STATE.merah.score = 0;
        RANDORI_STATE.putih.score = 0;
        RANDORI_HISTORY.push({ corner: 'merah', points: 0, label: 'DOUBLE DISKUALIFIKASI (KEDUA SUDUT BATSU)' });
        updateRandoriUI();
        alert("PERHATIAN:\nKedua atlet membawa sanksi Batsu/Diskualifikasi dari babak sebelumnya.\nPartai ini dinyatakan Diskualifikasi Ganda (Double WO).");
    } else if (isMerahBlocked && !isPutihBlocked) {
        // Sudut Merah Terblokir -> Putih Otomatis 10 Poin (Menang WO)
        RANDORI_STATE.putih.score = 10;
        RANDORI_STATE.merah.score = 0;
        RANDORI_HISTORY.push({ corner: 'putih', points: 10, label: 'IPPON / WO (BATSU MERAH)' });
        updateRandoriUI();
    } else if (isPutihBlocked && !isMerahBlocked) {
        // Sudut Putih Terblokir -> Merah Otomatis 10 Poin (Menang WO)
        RANDORI_STATE.merah.score = 10;
        RANDORI_STATE.putih.score = 0;
        RANDORI_HISTORY.push({ corner: 'merah', points: 10, label: 'IPPON / WO (BATSU PUTIH)' });
        updateRandoriUI();
    }

    // 6. Sinkronkan ke Layar TV
    if (typeof pushRandoriToTV === 'function') {
        pushRandoriToTV();
    }
}

function resetRandoriBoard() {
    RANDORI_STATE = { merah: { score: 0, warnings: 0 }, putih: { score: 0, warnings: 0 } };
    RANDORI_HISTORY = [];
    updateRandoriUI();
}

function addWarning(corner) {
    if (RANDORI_STATE[corner].warnings >= 6) return alert("Peringatan sudah mencapai batas maksimal (6).");

    RANDORI_STATE[corner].warnings += 1;
    let currentWarn = RANDORI_STATE[corner].warnings;
    let oppCorner = corner === 'merah' ? 'putih' : 'merah';

    // Logika Kelipatan 3: Setiap menyentuh kelipatan 3 (3, 6), lawan otomatis dapat +5 poin
    let addedPoints = 0;
    if (currentWarn > 0 && currentWarn % 3 === 0) {
        addedPoints = 5;
        RANDORI_STATE[oppCorner].score += addedPoints;
        RANDORI_HISTORY.push({ corner: oppCorner, points: addedPoints, label: `PERINGATAN KE-${currentWarn} LAWAN` });
    } else {
        RANDORI_HISTORY.push({ corner: corner, points: 0, label: `PERINGATAN (${currentWarn})` });
    }

    updateRandoriUI();
}

function addRandoriScore(corner, points, label = "POIN") {
    // 1. Simpan aksi ini ke dalam buku riwayat (Log)
    RANDORI_HISTORY.push({ corner: corner, points: points, label: label });

    // 2. Tambahkan nilainya
    RANDORI_STATE[corner].score += points;
    if (RANDORI_STATE[corner].score < 0) RANDORI_STATE[corner].score = 0;

    updateRandoriUI();
}

function updateRandoriUI() {
    document.getElementById('score-merah').innerText = RANDORI_STATE.merah.score;
    document.getElementById('score-putih').innerText = RANDORI_STATE.putih.score;

    // Update Kotak Visual Tracker Peringatan Merah (1-6)
    for (let i = 1; i <= 6; i++) {
        let box = document.getElementById(`warn-merah-${i}`);
        if (box) {
            if (i <= RANDORI_STATE.merah.warnings) {
                box.className = "w-7 h-6 rounded bg-amber-600 border border-amber-500 flex items-center justify-center text-[10px] text-white font-black shadow-sm transition-colors";
            } else {
                box.className = "w-7 h-6 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] text-slate-500 font-bold transition-colors";
            }
        }
    }

    // Update Kotak Visual Tracker Peringatan Putih (1-6)
    for (let i = 1; i <= 6; i++) {
        let box = document.getElementById(`warn-putih-${i}`);
        if (box) {
            if (i <= RANDORI_STATE.putih.warnings) {
                box.className = "w-7 h-6 rounded bg-amber-600 border border-amber-500 flex items-center justify-center text-[10px] text-white font-black shadow-sm transition-colors";
            } else {
                box.className = "w-7 h-6 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] text-slate-500 font-bold transition-colors";
            }
        }
    }

    let logTextEl = document.getElementById('randori-log-text');
    if (logTextEl) {
        if (RANDORI_HISTORY.length === 0) {
            logTextEl.innerHTML = "Belum ada poin tercatat...";
            logTextEl.className = "text-xs font-medium text-slate-400 italic tracking-wide";
        } else {
            let last = RANDORI_HISTORY[RANDORI_HISTORY.length - 1];
            let cornerName = last.corner === 'merah' ? '<span class="text-red-400 font-black tracking-widest bg-red-950 px-2 py-0.5 rounded border border-red-800">MERAH</span>' : '<span class="text-slate-200 font-black tracking-widest bg-slate-800 px-2 py-0.5 rounded border border-slate-600">PUTIH</span>';

            if (last.points > 0) {
                logTextEl.innerHTML = `Aksi Terakhir: ${cornerName} mendapat <span class="font-black text-amber-400 ml-1 tracking-wider">${last.label} (+${last.points})</span>`;
            } else {
                logTextEl.innerHTML = `Aksi Terakhir: ${cornerName} mencatat <span class="font-black text-blue-400 ml-1 tracking-wider">${last.label}</span>`;
            }
            logTextEl.className = "text-xs font-medium text-slate-300 flex items-center";
        }
    }
    pushRandoriToTV();
}

function undoLastRandoriScore() {
    if (RANDORI_HISTORY.length === 0) return alert("Belum ada aksi poin atau peringatan yang bisa dibatalkan.");

    let lastAction = RANDORI_HISTORY.pop();

    // Jika aksi terakhir adalah penambahan poin dari kelipatan peringatan, kita kurangi skor lawan dan turunkan peringatan pemiliknya
    if (lastAction.label.includes("PERINGATAN KE-")) {
        let targetCorner = lastAction.corner === 'merah' ? 'putih' : 'merah';
        RANDORI_STATE[lastAction.corner].score -= lastAction.points;
        if (RANDORI_STATE[lastAction.corner].score < 0) RANDORI_STATE[lastAction.corner].score = 0;
        if (RANDORI_STATE[targetCorner].warnings > 0) RANDORI_STATE[targetCorner].warnings -= 1;
    } else if (lastAction.label.includes("PERINGATAN")) {
        let targetCorner = lastAction.corner;
        if (RANDORI_STATE[targetCorner].warnings > 0) RANDORI_STATE[targetCorner].warnings -= 1;
    } else {
        RANDORI_STATE[lastAction.corner].score -= lastAction.points;
        if (RANDORI_STATE[lastAction.corner].score < 0) RANDORI_STATE[lastAction.corner].score = 0;
    }

    updateRandoriUI();
}

function saveRandoriMatchResult() {
    if (!currentRandoriMatchId) return alert("Pilih partai!");
    const match = STATE.matches.find(m => m.id === currentRandoriMatchId);
    if (!match) return;

    let sMerah = RANDORI_STATE.merah.score; 
    let sPutih = RANDORI_STATE.putih.score;
    if (sMerah === sPutih) return alert("Skor seri! Tambahkan poin kemenangan.");

    let winnerId = sMerah > sPutih ? match.merahId : match.putihId;
    let loserId = sMerah > sPutih ? match.putihId : match.merahId;
    let winnerName = sMerah > sPutih ? "PITA MERAH" : "PITA PUTIH";

    if (confirm(`Konfirmasi Pemenang: ${winnerName}\nSkor: ${sMerah} - ${sPutih}\n\nLanjutkan?`)) {
        match.skorMerah = sMerah; 
        match.skorPutih = sPutih;
        match.winnerId = winnerId; 
        match.loserId = loserId;
        match.status = 'done';

        // Tangkap Info Jejak Audit Petugas
        let wUtamaEl = document.getElementById('v-name-wasit');
        let offMEl = document.getElementById('v-name-merah');
        let offPEl = document.getElementById('v-name-putih');

        match.petugas = {
            wasitUtama: wUtamaEl ? wUtamaEl.innerText.replace('Menunggu...', 'Manual') : 'Manual',
            offMerah: offMEl ? offMEl.innerText.replace('Menunggu...', 'Manual') : 'Manual',
            offPutih: offPEl ? offPEl.innerText.replace('Menunggu...', 'Manual') : 'Manual'
        };

        recalculateAllLosses(match.kategori);
        let winnerP = STATE.participants.find(p => p.id === winnerId);
        let isGrandFinal = match.nextW === 'WINNER' && match.babak !== "SUDDEN DEATH";
        let isChallenger = winnerP && winnerP.losses > 0;

        let mode = (STATE.settings && STATE.settings.tournamentMode) ? STATE.settings.tournamentMode : 'double';
        if (mode === 'double' && isGrandFinal && isChallenger) {
            alert("TIE BREAKER GRAND FINAL!\nSistem membuka Partai Sudden Death!");
            STATE.matches = STATE.matches.filter(m => !(m.kategori === match.kategori && m.pool === match.pool && m.babak === "SUDDEN DEATH"));

            STATE.matches.push({ 
                id: Date.now(), 
                kategori: match.kategori, 
                pool: match.pool, 
                matchNum: match.matchNum + 1, 
                babak: "SUDDEN DEATH", 
                col: match.col + 1, 
                nextW: 'WINNER', 
                nextL: 'SECOND', 
                merahId: match.putihId, 
                putihId: match.merahId, 
                winnerId: null, 
                status: 'pending', 
                skorMerah: 0, 
                skorPutih: 0 
            });
        } else {
            // Majukan Pemenang ke nextW & Pihak Kalah (termasuk yang terkena Batsu) tetap ke nextL
            forwardParticipant(match.nextW, winnerId, match.kategori, match.pool, match.nextWSlot);
            if (match.nextL) forwardParticipant(match.nextL, loserId, match.kategori, match.pool, match.nextLSlot);
        }

        // Proses Auto-Win jika salah satu slot bertemu lawan kosong (BYE)
        processAutoWins(match.kategori);

        // 🔥 1. SIMPAN KE DATABASE LOKAL SQLITE / LAN
        saveToLocalStorage();

        // 🔥 2. SINKRONISASI SELURUH MATCHES KE FIREBASE (Mencegah data tertimpa)
        let updates = {};
        updates['turnamen_data/matches'] = STATE.matches;
        updates['turnamen_data/participants'] = STATE.participants;

        if (database) {
            database.ref().update(updates).then(() => {
                alert("Partai Selesai! Pemenang dicatat & bagan lanjutan diperbarui.");
                filterPesertaScoring(); 
                checkExistingDrawing(); 
                if (typeof closeVerificationModal === 'function') closeVerificationModal();
            }).catch(err => alert("Gagal Sinkronisasi Cloud: " + err));
        } else {
            alert("Partai Selesai! Pemenang dicatat.");
            filterPesertaScoring(); 
            checkExistingDrawing(); 
            if (typeof closeVerificationModal === 'function') closeVerificationModal();
        }
    }
}

document.getElementById('select-peserta').addEventListener('change', (e) => {
    HOLD_H2H_SCREEN = false;

    // 🔥 1. RESET TIMER OTOMATIS SESUAI DISIPLIN PARTAI YANG BARU DIPILIH
    // Jika Randori -> otomatis disetel ke 02:00 (Countdown)
    // Jika Embu (H2H / Baku / Festival) -> otomatis disetel ke 00:00 (Count-Up)
    if (typeof resetTimer === 'function') {
        resetTimer();
    }

    // 2. SELURUH FITUR BAWAAN TETAP BERJALAN 100% LENGKAP
    if (e.target.selectedIndex >= 0) {
        if (e.target.value.startsWith('match-')) {
            // Mode Randori
            document.getElementById('scoring-athlete-name').innerText = e.target.options[e.target.selectedIndex].text;
            let gridEl = document.getElementById('scoring-athlete-grid');
            if (gridEl) gridEl.className = 'hidden';
            loadRandoriMatch();
        } else if (e.target.value.startsWith('h2h-match-')) {
            // Mode Embu H2H
            updateScoringButtonsUI(); // Pancing UI Embu H2H
        } else {
            // Mode Embu Biasa / Baku / Festival
            document.getElementById('randori-nama-merah').innerText = "-";
            document.getElementById('randori-kont-merah').innerText = "-";
            document.getElementById('randori-nama-putih').innerText = "-";
            document.getElementById('randori-kont-putih').innerText = "-";
            currentRandoriMatchId = null;
            resetRandoriBoard();

            updateScoringButtonsUI();
        }
    }
});

document.getElementById('select-kategori').addEventListener('change', filterPesertaScoring);

function updateScoringButtonsUI() {
    const val = document.getElementById('select-peserta').value;
    
    let isEmbuBlocked = false;
    let embuSanctionDetail = null;
    let currentMatchId = null;
    let currentCorner = null;

    if (val && val.startsWith('h2h-match-')) {
        const parts = val.split('-');
        currentMatchId = parseInt(parts[2]);
        currentCorner = parts[3];
        const pId = parseInt(parts[4]);

        const p = STATE.participants.find(x => x.id === pId);
        if (p && checkAthleteSanctionBlocked(p, p.kategori)) {
            isEmbuBlocked = true;
            embuSanctionDetail = p.sanksiDetail;
        }
    } else if (val && val.includes('|')) {
        const pId = parseInt(val.split('|')[0]);
        const p = STATE.participants.find(x => x.id === pId);
        if (p && checkAthleteSanctionBlocked(p, p.kategori)) {
            isEmbuBlocked = true;
            embuSanctionDetail = p.sanksiDetail;
        }
    }

    // Render Tirai Gembok Embu (Kirim ID Partai & Sudut jika H2H)
    renderEmbuSanctionUI(isEmbuBlocked, embuSanctionDetail, currentMatchId, currentCorner);

    const btnB1 = document.getElementById('btn-save-b1');
    const btnB2 = document.getElementById('btn-save-b2');
    const btnPen = document.getElementById('btn-save-penyisihan');
    const btnFin = document.getElementById('btn-save-final');

    // SUNTIKAN: Deteksi jika ini adalah format Embu H2H
    if (val && val.startsWith('h2h-match-')) {
        if (isSaving) return;
        const parts = val.split('-'); // h2h(0), match(1), id(2), corner(3), pId(4)
        const matchId = parseInt(parts[2]);
        const corner = parts[3];
        const pId = parseInt(parts[4]);

        const p = STATE.participants.find(x => x.id === pId);
        const m = STATE.matches.find(x => x.id === matchId);
        if (!p || !m) return;

        let displayNum = m.matchNum % 50 === 0 ? 50 : m.matchNum % 50;

        // --- 🌟 PERBAIKAN UI: PECAH NAMA & BUAT GRID 🌟 ---
        let names = String(p.nama).split(/[,+&]/).map(n => n.trim()).filter(n => n);
        let displayNama = names.length > 1 ? `${names[0]} dkk` : p.nama;

        // DETEKSI MODE REVISI
        let isRevisi = false;
        if (corner === 'merah' && m.skorMerah > 0) isRevisi = true;
        if (corner === 'putih' && m.skorPutih > 0) isRevisi = true;

        // 1. Format Judul (Bersih & Elegan dengan Indikator Revisi)
        let titleEl = document.getElementById('scoring-athlete-name');
        titleEl.innerText = `[G-${displayNum}] PITA ${corner.toUpperCase()} - ${p.kontingen} (${displayNama}) ${isRevisi ? '[MODE REVISI]' : ''}`;
        titleEl.classList.remove('truncate');
        titleEl.classList.add('whitespace-normal', 'break-words');

        // 👇 🌟 SUNTIKAN FIX DOUBLE RENDER 🌟 👇
        // Hancurkan grid lama jika ada, pastikan selalu buat yang baru agar tidak terjadi blank!
        let oldGrid = document.getElementById('scoring-athlete-grid');
        if (oldGrid) oldGrid.remove();

        let gridEl = document.createElement('div');
        gridEl.id = 'scoring-athlete-grid';
        titleEl.after(gridEl);

        if (names.length > 1) {
            gridEl.className = "grid grid-cols-1 md:grid-cols-3 gap-2 bg-slate-800/60 p-3 rounded-xl border border-slate-700 shadow-inner mt-3 animate-fade-in";
            gridEl.innerHTML = names.map((n, i) => `
                <div class="flex items-center gap-2 bg-slate-900 p-2 rounded-md border border-slate-700/50 shadow-sm overflow-hidden">
                    <span class="w-5 h-5 rounded-full bg-blue-900/50 text-blue-400 border border-blue-700/50 text-[10px] flex items-center justify-center font-black shadow-sm flex-shrink-0">${i + 1}</span>
                    <span class="text-[11px] font-bold text-slate-200 leading-tight uppercase tracking-wider truncate" title="${n}">${n}</span>
                </div>
            `).join('');
        } else {
            gridEl.className = "hidden";
        }
        // 👆 🌟 AKHIR FIX DOUBLE RENDER 🌟 👆
        // ------------------------------------------------

        if (btnB1) {
            btnB1.classList.remove('hidden');

            if (isRevisi) {
                btnB1.innerHTML = `<i class="fas fa-edit mr-2"></i> UPDATE REVISI`;
                btnB1.className = `text-white text-sm font-black py-3.5 px-6 rounded-xl transition-transform hover:scale-105 bg-amber-600 hover:bg-amber-500 shadow-[0_0_20px_rgba(217,119,6,0.35)] ml-auto whitespace-nowrap tracking-wide h-12 flex items-center`;
            } else {
                let iconClass = corner === 'merah' ? 'fa-save' : 'fa-save';
                btnB1.innerHTML = `<i class="fas ${iconClass} mr-2"></i> SIMPAN ${corner.toUpperCase()}`;
                
                let colorClass = corner === 'merah' 
                    ? 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_20px_rgba(220,38,38,0.4)]' 
                    : 'bg-slate-200 hover:bg-white text-slate-900 shadow-[0_0_20px_rgba(255,255,255,0.2)]';
                
                btnB1.className = `text-sm font-black py-3.5 px-8 rounded-xl transition-transform hover:scale-105 ml-auto whitespace-nowrap tracking-wide h-12 flex items-center ${colorClass}`;
            }
        }
        if (btnB2) btnB2.classList.add('hidden');
        if (btnPen) btnPen.classList.add('hidden');
        if (btnFin) btnFin.classList.add('hidden');

        const btnWinner = document.getElementById('btn-tampil-pemenang-h2h');
        if (btnWinner) {
            if (m.skorMerah > 0 && m.skorPutih > 0) {
                btnWinner.classList.remove('hidden');
                // Styling Baru Tombol Keputusan Final
                btnWinner.className = "bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-400 hover:to-amber-400 text-slate-950 font-black py-3.5 px-8 rounded-xl transition-transform hover:scale-105 shadow-[0_0_25px_rgba(234,179,8,0.5)] tracking-widest text-sm whitespace-nowrap ml-3 flex items-center h-12 animate-pulse";
                btnWinner.innerHTML = '<i class="fas fa-gavel mr-2.5"></i> KEPUTUSAN FINAL';
            } else {
                btnWinner.classList.add('hidden');
            }
        }

        const currentRole = sessionStorage.getItem('role');
        const safeCourtId = DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';
        if (currentRole === 'panitera') {
            const btnTembak = document.getElementById('btnTembakWasit');
            if (btnTembak) btnTembak.classList.remove('hidden');

            // 🔥 HANYA TEMBAK & GEMBOK JIKA WASIT DIGITAL AKTIF
            if (typeof isWasitDigitalMode !== 'undefined' && isWasitDigitalMode) {
                tembakDataKeFirebase();
                if (btnB1) { btnB1.disabled = true; btnB1.classList.add('opacity-50', 'cursor-not-allowed'); }
            } else {
                if (btnB1) { btnB1.disabled = false; btnB1.classList.remove('opacity-50', 'cursor-not-allowed'); }
            }

            listenStatusJuri(safeCourtId);
        }

        // --- 🌟 PERBAIKAN BUG WAKTU EMBU H2H 🌟 ---
        let rule = getEmbuTimeRule(p.kategori);
        let timeLabelEl = document.getElementById('embu-time-label');
        let timeValueEl = document.getElementById('embu-time-value');
        if (timeLabelEl) timeLabelEl.innerText = `Mode: ${rule.type}`;
        if (timeValueEl) {
            let fmtMin = `${Math.floor(rule.min / 60).toString().padStart(2, '0')}:${(rule.min % 60).toString().padStart(2, '0')}`;
            let fmtMax = `${Math.floor(rule.max / 60).toString().padStart(2, '0')}:${(rule.max % 60).toString().padStart(2, '0')}`;
            timeValueEl.innerText = `${fmtMin} - ${fmtMax}`;
        }

        // Buka form baru yang bersih
        loadExistingScores();
        return;
    }

    if (!val || !val.includes('|')) return;
    const [pIdStr, babak] = val.split('|');
    const pId = parseInt(pIdStr);

    const p = STATE.participants.find(x => x.id === pId);
    if (p) {
        let catObj = STATE.categories.find(c => c.name === p.kategori);

        let babakText = "";
        if (catObj && catObj.discipline === 'festival') {
            babakText = `Kelompok ${p.pool}`;
        } else {
            babakText = babak === 'b1' ? (p.pool !== '-' && p.pool !== 'SINGLE' ? `Pool ${p.pool}` : `Babak 1`) : (p.isFinalist ? 'FINAL' : 'Babak 2');
        }

        let noUrut = p.urut;
        if (babak === 'b1') {
            noUrut = p.urut;
        } else if (p.isFinalist) {
            noUrut = p.urutFinal;
        } else {
            noUrut = p.urutB2 > 0 ? p.urutB2 : "?";
        }
        if (!noUrut) noUrut = "?";

        let names = p.nama.split(/[,+&]/).map(n => n.trim()).filter(n => n);
        let displayNama = names.length > 1 ? `${names[0]} dkk` : p.nama;

        let titleText = (p.kontingen && p.kontingen !== "-")
            ? `[${babakText}] No.${noUrut} - ${displayNama} (${p.kontingen})`
            : `[${babakText}] No.${noUrut} - ${displayNama}`;

        let titleEl = document.getElementById('scoring-athlete-name');
        titleEl.innerText = titleText;

        titleEl.classList.remove('truncate');
        titleEl.classList.add('whitespace-normal', 'break-words');

        // 👇 🌟 SUNTIKAN FIX DOUBLE RENDER JALUR EMBU BAKU/FESTIVAL 🌟 👇
        let oldGrid = document.getElementById('scoring-athlete-grid');
        if (oldGrid) oldGrid.remove();

        let gridEl = document.createElement('div');
        gridEl.id = 'scoring-athlete-grid';
        titleEl.after(gridEl);

        if (names.length > 1) {
            gridEl.className = "grid grid-cols-1 md:grid-cols-3 gap-2 bg-slate-800/60 p-3 rounded-xl border border-slate-700 shadow-inner mt-3 animate-fade-in";
            gridEl.innerHTML = names.map((n, i) => `
                <div class="flex items-center gap-2 bg-slate-900 p-2 rounded-md border border-slate-700/50 shadow-sm overflow-hidden">
                    <span class="w-5 h-5 rounded-full bg-blue-900/50 text-blue-400 border border-blue-700/50 text-[10px] flex items-center justify-center font-black shadow-sm flex-shrink-0">${i + 1}</span>
                    <span class="text-[11px] font-bold text-slate-200 leading-tight uppercase tracking-wider truncate" title="${n}">${n}</span>
                </div>
            `).join('');
        } else {
            gridEl.className = "hidden";
        }
        // 👆 🌟 AKHIR FIX DOUBLE RENDER 🌟 👆
    }

    if (btnB1) btnB1.classList.add('hidden');
    if (btnB2) btnB2.classList.add('hidden');
    if (btnPen) btnPen.classList.add('hidden');
    if (btnFin) btnFin.classList.add('hidden');

    // 👇 FIX: Sembunyikan juga tombol Juara H2H agar tidak bocor ke mode Baku/Festival!
    const btnWinner = document.getElementById('btn-tampil-pemenang-h2h');
    if (btnWinner) btnWinner.classList.add('hidden');

    let catObj = STATE.categories.find(c => c.name === p.kategori);

    if (catObj && catObj.discipline === 'festival') {
        if (btnB1) {
            btnB1.classList.remove('hidden');
            btnB1.innerHTML = '<i class="fas fa-save mr-2"></i>SIMPAN NILAI';
            btnB1.className = "flex-1 md:flex-none bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded-xl transition-transform hover:scale-105 shadow-[0_4px_14px_0_rgba(34,197,94,0.39)]";
        }
    } else {
        if (babak === 'b1') {
            if (btnB1) {
                btnB1.classList.remove('hidden');
                if (val.includes('[Pool')) {
                    btnB1.innerHTML = '<i class="fas fa-save mr-2"></i>SIMPAN PENYISIHAN';
                    btnB1.className = "flex-1 md:flex-none bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-xl transition-transform hover:scale-105 shadow-[0_4px_14px_0_rgba(37,99,235,0.39)]";
                } else {
                    btnB1.innerHTML = '<i class="fas fa-save mr-2"></i>SIMPAN BABAK 1';
                    btnB1.className = "flex-1 md:flex-none bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-xl transition-transform hover:scale-105 shadow-[0_4px_14px_0_rgba(37,99,235,0.39)]";
                }
            }
        } else {
            if (btnB2) {
                btnB2.classList.remove('hidden');
                if (val.includes('[FINAL]')) {
                    btnB2.innerHTML = '<i class="fas fa-save mr-2"></i>SIMPAN FINAL';
                    btnB2.className = "flex-1 md:flex-none bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-3 px-6 rounded-xl transition-transform hover:scale-105 shadow-[0_4px_14px_0_rgba(202,138,4,0.39)]";
                } else {
                    btnB2.innerHTML = '<i class="fas fa-save mr-2"></i>SIMPAN BABAK 2';
                    btnB2.className = "flex-1 md:flex-none bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 px-6 rounded-xl transition-transform hover:scale-105 shadow-[0_4px_14px_0_rgba(147,51,234,0.39)]";
                }
            }
        }
    }

    let rule = getEmbuTimeRule(p.kategori);
    let timeLabelEl = document.getElementById('embu-time-label');
    let timeValueEl = document.getElementById('embu-time-value');
    if (timeLabelEl) timeLabelEl.innerText = `Mode: ${rule.type}`;
    if (timeValueEl) {
        let fmtMin = `${Math.floor(rule.min / 60).toString().padStart(2, '0')}:${(rule.min % 60).toString().padStart(2, '0')}`;
        let fmtMax = `${Math.floor(rule.max / 60).toString().padStart(2, '0')}:${(rule.max % 60).toString().padStart(2, '0')}`;
        timeValueEl.innerText = `${fmtMin} - ${fmtMax}`;
    }

    loadExistingScores();

    if (typeof updateBroadcastUI === "function") updateBroadcastUI();

    // 👇 SUNTIKAN TV PINTAR: PREVIEW EMBU (BAKU/FESTIVAL/H2H) 👇
    if (typeof IS_TV_LIVE !== 'undefined' && IS_TV_LIVE && DEVICE_ROLE !== 'admin') {
        let namesTV = String(p.nama).split(/[,+&]/).map(n => n.trim()).filter(n => n);
        let tvNamaLengkap = namesTV.join(" & ");

        let wazaList = [];
        if (p.idFirestore) {
            try {
                let cacheWaza = JSON.parse(localStorage.getItem('CACHE_WAZA_EMBU')) || {};
                if (cacheWaza[p.idFirestore]) wazaList = cacheWaza[p.idFirestore];
            } catch (e) { }
        }

        let tipePita = 'baku';
        if (val && val.startsWith('h2h-match-')) {
            tipePita = val.split('-')[3];
        }

        let payloadPreview = {
            payload_id: Date.now().toString() + "-PREV1-" + Math.floor(Math.random() * 1000),
            type: 'embu', current_action: 'preview',
            preview_data: {
                kategori: p.kategori, nama: tvNamaLengkap, kontingen: p.kontingen,
                pita: tipePita, waza: wazaList
            }
        };

        if (TV_PREVIEW_TIMEOUT) clearTimeout(TV_PREVIEW_TIMEOUT);
        TV_PREVIEW_TIMEOUT = setTimeout(() => {
            if (database) database.ref(`live_broadcast/${DEVICE_ROLE}`).set(payloadPreview).catch(e => console.warn(e));
            if (typeof localSocket !== 'undefined' && localSocket) {
                localSocket.emit('broadcast_to_tv', { channel: 'global_tv', court: DEVICE_ROLE, payload: payloadPreview });
            }
        }, 300);
    }
    // 👆 AKHIR SUNTIKAN TV PINTAR 👆

    const currentRole = sessionStorage.getItem('role');
    const safeCourtId = DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';

    if (currentRole === 'panitera' && catObj && catObj.discipline !== 'randori') {
        const btnTembak = document.getElementById('btnTembakWasit');
        if (btnTembak) btnTembak.classList.remove('hidden');

        // 🔥 HANYA TEMBAK & GEMBOK JIKA WASIT DIGITAL AKTIF
        if (typeof isWasitDigitalMode !== 'undefined' && isWasitDigitalMode) {
            tembakDataKeFirebase();
            if (btnB1) { btnB1.disabled = true; btnB1.classList.add('opacity-50', 'cursor-not-allowed'); }
            if (btnB2) { btnB2.disabled = true; btnB2.classList.add('opacity-50', 'cursor-not-allowed'); }
        } else {
            if (btnB1) { btnB1.disabled = false; btnB1.classList.remove('opacity-50', 'cursor-not-allowed'); }
            if (btnB2) { btnB2.disabled = false; btnB2.classList.remove('opacity-50', 'cursor-not-allowed'); }
        }

        listenStatusJuri(safeCourtId);
    }
}

// --- SUNTIKAN: SISTEM PENUGASAN WASIT BERBASIS OFFLINE QR ---

// --- LOGIKA ACCORDION ---
function togglePenugasanWasit() {
    const body = document.getElementById('body-penugasan-wasit');
    const icon = document.getElementById('icon-penugasan-wasit');

    if (body.classList.contains('hidden')) {
        body.classList.remove('hidden');
        icon.style.transform = 'rotate(180deg)';
        // Pastikan render saat dibuka agar data ter-update
        renderDropdownWasit();
    } else {
        body.classList.add('hidden');
        icon.style.transform = 'rotate(0deg)';
    }
}

function renderDropdownWasit() {
    const container = document.getElementById('dropdown-wasit-container');
    if (!container) return;

    let numJudges = parseInt(localStorage.getItem('local_judges')) || 5;

    // 1. Simpan pilihan wasit yang sedang aktif agar tidak hilang saat re-render
    let tempSelections = {};
    for (let i = 1; i <= numJudges; i++) {
        let el = document.getElementById(`pilih-w${i}`);
        if (el) tempSelections[i] = el.value;
    }

    // 2. Tarik & Filter Data dengan Pelindung Huruf Kapital & Spasi (.trim().toUpperCase())
    let dataWasit = (STATE.barcodes || []).filter(b => b.jabatan && String(b.jabatan).trim().toUpperCase() === 'WASIT');

    let courtTugasActive = typeof DEVICE_ROLE !== 'undefined' && DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'ALL';

    // Filter wasit sesuai area tugas (ALL atau sesuai court aktif)
    let availableWasit = dataWasit.filter(w => !w.courtTugas || w.courtTugas === 'ALL' || w.courtTugas === courtTugasActive);

    // Fallback cerdas: Jika shortId belum ada, gunakan nama atau ID sebagai nilai opsi
    let options = availableWasit.map(w => {
        let valId = w.shortId || w.id || w.nama;
        let kontingenText = (!w.kontingen || w.kontingen === '-') ? 'Wasit' : w.kontingen;
        return `<option value="${valId}">${w.nama} (${kontingenText})</option>`;
    }).join('');

    let emptyOption = `<option value="">-- Pilih Wasit --</option>`;

    let html = '';
    for (let i = 1; i <= numJudges; i++) {
        html += `
<div class="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded p-1 shadow-sm focus-within:border-blue-500 transition-colors">
    <div class="bg-slate-800 text-slate-400 font-bold text-[10px] w-8 h-8 flex items-center justify-center rounded border border-slate-600 shadow-inner shrink-0">W${i}</div>
    <!-- TAMBAHKAN text-slate-900 DI SINI -->
    <select id="pilih-w${i}" class="w-full bg-white text-slate-900 text-xs outline-none font-semibold cursor-pointer p-1 rounded">
        ${emptyOption}
        ${options}
    </select>
</div>`;
    }
    container.innerHTML = html;

    // 3. Kembalikan pilihan memori yang disimpan tadi
    for (let i = 1; i <= numJudges; i++) {
        let el = document.getElementById(`pilih-w${i}`);
        if (el && tempSelections[i]) {
            el.value = tempSelections[i];
        }
    }
}

// Injeksi otomatis ke fungsi setJudges bawaan
const originalSetJudges = setJudges;
setJudges = function (n) {
    originalSetJudges(n);
    renderDropdownWasit();
};

// =========================================================
// 🌟 GENERATOR QR PENUGASAN WASIT (SMART ADAPTIVE URL)
// =========================================================
async function openQRTugasModal() {
    let numJudges = parseInt(localStorage.getItem('local_judges')) || 5;
    let selectedNames = [];
    let penugasanObj = {};

    // 1. Validasi Form Pemilihan Wasit
    for (let i = 1; i <= numJudges; i++) {
        let selectEl = document.getElementById(`pilih-w${i}`);
        if (!selectEl || !selectEl.value) return alert(`Lengkapi form! Kursi Wasit ${i} belum diisi.`);

        let namaWasit = selectEl.options[selectEl.selectedIndex].text.split('(')[0].trim();
        selectedNames.push(`w${i}=${encodeURIComponent(namaWasit)}`);
        penugasanObj[`w${i}`] = namaWasit;
    }

    let safeCourtId = typeof DEVICE_ROLE !== 'undefined' && DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';

    // 2. Konfirmasi Rotasi Wasit
    if (!confirm(`⚠️ KONFIRMASI ROTASI WASIT (${safeCourtId.replace('_', ' ').toUpperCase()}):\n\nMenampilkan QR baru akan mereset tugas wasit yang sedang aktif dan mengembalikan HP mereka ke halaman portal.\n\nLanjutkan untuk membuat sesi baru?`)) {
        return;
    }

    const logoutPayload = {
        action: 'logout_posisi',
        timestamp: Date.now()
    };

    // 3. Kirim Sinyal Reset via Firebase & Socket.io
    if (database) {
        database.ref(`live_embu/${safeCourtId}/command`).set(logoutPayload).catch(e => console.warn(e));
        database.ref(`live_embu/${safeCourtId}/penugasan`).set({
            court: safeCourtId,
            numJudges: numJudges,
            wasit: penugasanObj,
            updatedAt: Date.now()
        }).catch(e => console.warn(e));
    }

    if (typeof localSocket !== 'undefined' && localSocket && localSocket.connected) {
        localSocket.emit('broadcast_to_tv', {
            channel: 'lokal_panitera',
            court: safeCourtId,
            payload: logoutPayload
        });
        localSocket.emit('broadcast_to_tv', {
            channel: 'penugasan_wasit',
            court: safeCourtId,
            payload: { court: safeCourtId, numJudges: numJudges, wasit: penugasanObj }
        });
    }

    // 4. 🔥 SMART URL RESOLVER (Prioritas: Input Admin -> Cloud Setting -> LAN IP -> Fallback Origin)
    let baseUrl = "";
    let pathUrl = "";

    // A. Cek apakah ada URL Wasit khusus yang diinput di Tab Admin / Local Storage / Cloud Settings
    const inputWasitUrl = document.getElementById('setting-wasit-url') ? document.getElementById('setting-wasit-url').value.trim() : "";
    const savedWasitUrl = (STATE.settings && (STATE.settings.wasitUrl || STATE.settings.wasitBaseUrl)) ? (STATE.settings.wasitUrl || STATE.settings.wasitBaseUrl).trim() : "";
    const localSavedWasitUrl = (localStorage.getItem('mass_wasit_url') || "").trim();

    const customWasitUrl = inputWasitUrl || savedWasitUrl || localSavedWasitUrl;

    if (customWasitUrl) {
        // Menggunakan URL Cloud Khusus (misal: https://scoringwasit.netlify.app)
        baseUrl = customWasitUrl;
        pathUrl = "";
    } else {
        // B. Jika tidak ada URL khusus, deteksi apakah ini Server Lokal Node.js (LAN / Hybrid)
        try {
            const response = await fetch('/api/server-ip');
            if (response.ok) {
                const data = await response.json();
                const port = window.location.port ? ':' + window.location.port : '';
                baseUrl = `http://${data.ip}${port}`;
                pathUrl = "/scoring/wasit.html";
            } else {
                throw new Error("Bukan API server lokal");
            }
        } catch (error) {
            // C. Fallback Domain Saat Ini
            baseUrl = window.location.origin;
            pathUrl = window.location.pathname.includes('/scoring/') ? "/scoring/wasit.html" : "/wasit.html";
        }
    }

    // 5. Susun Parameter Query String dengan Rapi
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    const fullTargetUrl = `${baseUrl}${pathUrl}`;
    const separator = fullTargetUrl.includes('?') ? '&' : '?';
    const qrString = `${fullTargetUrl}${separator}court=${safeCourtId}&${selectedNames.join('&')}`;

    // 6. Render Canvas QR Code
    const qrCanvas = document.getElementById("qr-tugas-canvas");
    if (qrCanvas) {
        qrCanvas.innerHTML = "";
        new QRCode(qrCanvas, {
            text: qrString,
            width: 250,
            height: 250,
            colorDark: "#0f172a",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.L
        });
    }

    const subtitleEl = document.getElementById('qr-tugas-subtitle');
    if (subtitleEl) {
        subtitleEl.innerText = `${safeCourtId.replace('_', ' ').toUpperCase()} • ${numJudges} JURI • MODE EMBU`;
    }

    const modalTugas = document.getElementById('qr-tugas-modal');
    if (modalTugas) modalTugas.classList.remove('hidden');
}

function closeQRTugasModal() {
    document.getElementById('qr-tugas-modal').classList.add('hidden');
}

function setJudges(n) {
    localStorage.setItem('local_judges', n);

    let btnJ3 = document.getElementById('btn-j3');
    let btnJ5 = document.getElementById('btn-j5');
    if (btnJ3) btnJ3.className = n === 3 ? 'px-4 py-1.5 rounded font-bold text-sm bg-blue-600 text-white' : 'px-4 py-1.5 rounded font-semibold text-sm text-slate-400 hover:text-white';
    if (btnJ5) btnJ5.className = n === 5 ? 'px-4 py-1.5 rounded font-bold text-sm bg-blue-600 text-white' : 'px-4 py-1.5 rounded font-semibold text-sm text-slate-400 hover:text-white';

    const container = document.getElementById('judge-inputs');
    if (!container) return;

    // Simpan nilai sementara agar tidak hilang saat klik tombol 3 Wasit / 5 Wasit
    let tempScores = [];
    let tempTechs = [];
    for (let i = 1; i <= 5; i++) {
        let sEl = document.getElementById(`score-${i}`);
        let tEl = document.getElementById(`tech-${i}`);
        tempScores.push(sEl ? sEl.value : '');
        tempTechs.push(tEl ? tEl.value : '');
    }

    container.innerHTML = '';

    // --- TAMPILAN HYBRID UNTUK SEMUA ROLE (Bisa Manual & Bisa Terima Data Digital) ---
    for (let i = 1; i <= n; i++) {
        container.innerHTML += `
        <div class="bg-slate-900 p-3 rounded-lg border border-slate-600 focus-within:border-blue-500 transition-colors relative overflow-hidden group">
            <div class="text-center mb-2 pb-2 border-b border-slate-700">
                <label class="block text-[10px] text-slate-400 uppercase font-bold">Wasit ${i}</label>
            </div>
            
            <div class="space-y-2 relative z-10">
                <div>
                    <label class="block text-[9px] text-slate-500 mb-1">TOTAL NILAI</label>
                    <input type="number" step="0.5" id="score-${i}" value="${tempScores[i - 1] || ''}" oninput="calculateLive()" class="w-full bg-slate-800 p-2 rounded text-2xl font-black outline-none text-center text-white placeholder-slate-700" placeholder="0.0">
                </div>
                <div>
                    <label class="block text-[9px] text-slate-500 mb-1 flex justify-between">
                        <span>TEKNIK</span> ${i === 1 ? '<span class="text-yellow-500 font-bold">TIE-BREAK</span>' : ''}
                    </label>
                    <input type="number" step="0.5" id="tech-${i}" value="${tempTechs[i - 1] || ''}" oninput="calculateLive()" class="w-full bg-slate-800 p-2 rounded text-sm font-bold outline-none text-center ${i === 1 ? 'text-yellow-400' : 'text-blue-300'} placeholder-slate-700" placeholder="Opsional">
                </div>
            </div>

                        <!-- Tombol Batal/Manual (Muncul untuk membuka gembok stempel) -->
            <button onclick="resetJuriTunggal(${i})" id="btnReset${i}" class="hidden absolute top-0 right-0 bg-red-600 text-white w-8 h-8 rounded-bl-xl shadow-lg z-30 flex items-center justify-center hover:bg-red-500 transition-colors" title="Batal & Ubah Manual">
                <i class="fas fa-unlock text-xs"></i>
            </button>
        </div>
        `;
    }

    // 🔥 BROADCAST JUMLAH WASIT KE FIREBASE DAN JARINGAN LOKAL
    const safeCourtId = typeof DEVICE_ROLE !== 'undefined' && DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';
    if (database) {
        database.ref(`live_embu/${safeCourtId}/numJudges`).set(n).catch(e => console.warn(e));
    }
    if (typeof localSocket !== 'undefined' && localSocket) {
        localSocket.emit('broadcast_to_tv', {
            channel: 'lokal_panitera',
            court: safeCourtId,
            payload: { numJudges: n }
        });
    }

    calculateLive();
}

let juriListenerRef = null; // Gembok listener agar tidak menumpuk (Memory Leak)

// 1. Tambahkan memori status reset di bagian atas (luar fungsi)
let requestedResetJuri = { 1: false, 2: false, 3: false, 4: false, 5: false };

// 2. Timpa fungsi ini
function listenStatusJuri(courtId) {
    if (!database) return; // 🛡️ SUNTIKAN ANTI-CRASH: Hentikan fungsi jika Firebase mati

    const rtdbRef = database.ref(`live_embu/${courtId}`);

    // Matikan listener yang lama sebelum membuat yang baru
    if (juriListenerRef) juriListenerRef.off();
    juriListenerRef = rtdbRef;

    rtdbRef.on('value', (snapshot) => {

        // =========================================================
        // 🛡️ SABUK PENGAMAN 1: CEGAH CRASH SAAT DATA DIHAPUS MANUAL
        // =========================================================
        if (!snapshot.exists() || snapshot.val() === null) {
            console.warn("Data RTDB live_embu terhapus. Sabuk pengaman aktif menahan UI!");
            return; // Hentikan fungsi di sini agar panel wasit tidak ikut lenyap
        }
        // =========================================================

        const liveData = snapshot.val() || {};
        const dataJuri = liveData.juri || {};
        const selectEl = document.getElementById('select-peserta');
        const currentSelectedPartai = selectEl ? selectEl.value : null;

        // 🛡️ FILTER ANTI-BOCOR
        if (liveData.partai_id && currentSelectedPartai && liveData.partai_id !== currentSelectedPartai) {
            return;
        }

        let actualJudges = parseInt(localStorage.getItem('local_judges')) || 5;
        let submittedJudges = 0;

        for (let i = 1; i <= actualJudges; i++) {
            const inputScore = document.getElementById(`score-${i}`);
            const inputTech = document.getElementById(`tech-${i}`);
            const stempel = document.getElementById(`stempelJuri${i}`);
            const btnReset = document.getElementById(`btnReset${i}`);

            if (!inputScore) continue;

            // 🌟 CEK MEMORI LOKAL LAPTOP DULU
            let hasLocalMemory = false;
            let localScore = '';
            let localTech = '';

            if (currentSelectedPartai && currentSelectedPartai.startsWith('h2h-match-')) {
                const parts = currentSelectedPartai.split('-');
                const mId = parseInt(parts[2]);
                const crn = parts[3];
                const mm = STATE.matches.find(x => x.id === mId);
                if (mm) {
                    let pRaw = crn === 'merah' ? mm.rawMerah : mm.rawPutih;
                    let pTech = crn === 'merah' ? mm.techRawMerah : mm.techRawPutih;
                    if (pRaw && pRaw[i - 1] !== undefined) {
                        hasLocalMemory = true;
                        localScore = pRaw[i - 1];
                        localTech = (pTech && pTech[i - 1] !== undefined) ? pTech[i - 1] : '';
                    }
                }
            }

            if (dataJuri[i]) {
                // KONDISI 1: WASIT MENGIRIM DATA DARI HP (KUNCI GEMBOK)
                requestedResetJuri[i] = false;

                inputScore.value = dataJuri[i].total;
                if (inputTech) inputTech.value = dataJuri[i].teknik;
                TEMP_RINCIAN_WASIT[i] = dataJuri[i].rincian || "";

                inputScore.readOnly = true;
                if (inputTech) inputTech.readOnly = true;
                inputScore.classList.remove('text-yellow-500'); // Hapus warna manual jika ada
                inputScore.classList.add('text-green-400', 'font-black');

                if (stempel) stempel.classList.remove('hidden');

                if (btnReset) {
                    btnReset.classList.remove('hidden');
                    btnReset.className = "absolute top-0 right-0 bg-red-600 text-white w-8 h-8 rounded-bl-xl shadow-lg z-30 flex items-center justify-center hover:bg-red-500 transition-colors cursor-pointer";
                    btnReset.innerHTML = '<i class="fas fa-lock text-xs"></i>';
                    btnReset.title = "Buka Kunci Wasit";
                }
                submittedJudges++;
            } else {
                // KONDISI 2: DATA FIREBASE KOSONG (Cek apakah ini Mode Revisi atau Murni Kosong)
                if (hasLocalMemory && !requestedResetJuri[i]) {
                    // 🌟 PERBAIKAN: MODE REVISI / MANUAL = BUKA GEMBOK!

                    // Jangan timpa value jika Panitera sedang mengetik nilai baru
                    if (inputScore.value === '') inputScore.value = localScore;
                    if (inputTech && inputTech.value === '') inputTech.value = localTech;

                    inputScore.readOnly = false; // BUKA KUNCI AGAR BISA DIKETIK LANGSUNG OLEH PANITERA
                    if (inputTech) inputTech.readOnly = false;

                    inputScore.classList.remove('text-green-400');
                    inputScore.classList.add('text-yellow-500', 'font-black'); // Beri warna kuning (Tanda Manual/Memory)

                    if (stempel) stempel.classList.add('hidden');

                    if (btnReset) {
                        btnReset.classList.remove('hidden');
                        // Tombol jadi kuning (Edit), bukan merah (Gembok)
                        btnReset.className = "absolute top-0 right-0 bg-yellow-600 text-white w-8 h-8 rounded-bl-xl shadow-lg z-30 flex items-center justify-center hover:bg-yellow-500 transition-colors cursor-pointer";
                        btnReset.innerHTML = '<i class="fas fa-edit text-xs"></i>';
                        btnReset.title = "Ketik Langsung atau Klik untuk Minta Wasit Ulang";
                    }
                } else {
                    // MURNI KOSONG / SEDANG PROSES REVISI DARI WASIT
                    inputScore.readOnly = false;
                    if (inputTech) inputTech.readOnly = false;
                    inputScore.classList.remove('text-green-400', 'text-yellow-500', 'font-black');
                    delete TEMP_RINCIAN_WASIT[i];

                    if (stempel) stempel.classList.add('hidden');

                    if (requestedResetJuri[i] && btnReset) {
                        btnReset.classList.remove('hidden');
                        btnReset.className = "absolute top-0 right-0 bg-blue-500 text-white w-8 h-8 rounded-bl-xl shadow-lg z-30 flex items-center justify-center hover:bg-blue-400 transition-colors";
                        btnReset.innerHTML = '<i class="fas fa-sync-alt fa-spin text-xs"></i>';
                        btnReset.title = "Menunggu Wasit (Bisa Diisi Manual)";
                    } else if (btnReset) {
                        btnReset.classList.add('hidden');
                    }
                }
            }
        }
        calculateLive();
    });
}

function resetJuriTunggal(nomorJuri) {
    if (confirm(`Minta Wasit ${nomorJuri} mengisi ulang nilainya?\n\n(Layar HP wasit akan terbuka kembali).`)) {
        const safeCourtId = typeof DEVICE_ROLE !== 'undefined' && DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';

        requestedResetJuri[nomorJuri] = true;

        if (database) {
            database.ref(`live_embu/${safeCourtId}/juri/${nomorJuri}`).set(null).catch(e => console.warn(e));
        }

        // 🔥 SINKRONISASI SOCKET.IO UNTUK JARINGAN LOKAL MURNI (LAN)
        if (typeof localSocket !== 'undefined' && localSocket) {
            localSocket.emit('broadcast_to_tv', {
                channel: 'lokal_panitera',
                court: safeCourtId,
                payload: { action: 'reset_juri_tunggal', nomorJuri: nomorJuri }
            });
        }

        document.getElementById(`score-${nomorJuri}`).value = '';
        if (document.getElementById(`tech-${nomorJuri}`)) document.getElementById(`tech-${nomorJuri}`).value = '';
        calculateLive();
    }
}

function loadExistingScores() {
    // 🔥 SUNTIKAN PERBAIKAN: Definisikan 'val' terlebih dahulu!
    const val = document.getElementById('select-peserta') ? document.getElementById('select-peserta').value : null;

    if (val && val.startsWith('h2h-match-')) {
        requestedResetJuri = { 1: false, 2: false, 3: false, 4: false, 5: false };

        const parts = val.split('-');
        const matchId = parseInt(parts[2]);
        const corner = parts[3];
        const pId = parseInt(parts[4]); // 👈 TAMBAHAN WAJIB: Tarik ID Atlet dari dropdown

        const match = STATE.matches.find(m => m.id === matchId);
        const p = STATE.participants.find(x => x.id === pId); // 👈 TAMBAHAN WAJIB: Definisikan 'p'

        let pastRaw = [];
        let pastTech = [];
        let pastTime = 0;

        // 🌟 TARIK MEMORI LOKAL JIKA ADA (MODE REVISI)
        if (match) {
            if (corner === 'merah' && match.rawMerah) {
                pastRaw = match.rawMerah;
                pastTech = match.techRawMerah || [];
                pastTime = match.waktuMerah || 0;
            } else if (corner === 'putih' && match.rawPutih) {
                pastRaw = match.rawPutih;
                pastTech = match.techRawPutih || [];
                pastTime = match.waktuPutih || 0;
            }
        }

        let currentLocalJudges = parseInt(localStorage.getItem('local_judges')) || 5;

        if (pastRaw.length > 0 && pastRaw.length !== currentLocalJudges) {
            setJudges(pastRaw.length);
            currentLocalJudges = pastRaw.length;
        }

        for (let i = 1; i <= currentLocalJudges; i++) {
            let sEl = document.getElementById(`score-${i}`);
            let tEl = document.getElementById(`tech-${i}`);
            if (sEl) sEl.value = pastRaw[i - 1] !== undefined ? pastRaw[i - 1] : '';
            if (tEl) tEl.value = pastTech[i - 1] !== undefined ? pastTech[i - 1] : '';
        }

        UI.timerSeconds = pastTime;
        updateTimerUI();
        calculateLive();

        // 👇 SUNTIKAN TV PINTAR: PREVIEW EMBU H2H 👇
        if (typeof IS_TV_LIVE !== 'undefined' && IS_TV_LIVE && DEVICE_ROLE !== 'admin') {
            let namesTV = String(p.nama).split(/[,+&]/).map(n => n.trim()).filter(n => n);
            let tvNamaLengkap = namesTV.join(" & ");

            let wazaList = [];
            if (p.idFirestore) {
                try {
                    let cacheWaza = JSON.parse(localStorage.getItem('CACHE_WAZA_EMBU')) || {};
                    if (cacheWaza[p.idFirestore]) wazaList = cacheWaza[p.idFirestore];
                } catch (e) { }
            }

            let payloadPreview = {
                payload_id: Date.now().toString() + "-" + Math.floor(Math.random() * 10000),
                type: 'embu',
                current_action: 'preview',
                preview_data: {
                    kategori: p.kategori,
                    nama: tvNamaLengkap,
                    kontingen: p.kontingen,
                    pita: corner, // 👈 WAJIB menggunakan 'corner'
                    waza: wazaList
                }
            };

            if (database) database.ref(`live_broadcast/${DEVICE_ROLE}`).set(payloadPreview).catch(e => console.warn(e));
            if (typeof localSocket !== 'undefined' && localSocket) {
                localSocket.emit('broadcast_to_tv', { channel: 'global_tv', court: DEVICE_ROLE, payload: payloadPreview });
            }
        }
        return; // <-- (Ini baris asli yang sudah ada sebelumnya)
    }

    if (!val || !val.includes('|')) return;

    // 👇 SUNTIKAN RESET IKON RESTART (Matikan Semua Bendera Restart Saat Ganti Atlet) 👇
    requestedResetJuri = { 1: false, 2: false, 3: false, 4: false, 5: false };

    const [pIdStr, babak] = val.split('|');
    const pId = parseInt(pIdStr);

    const p = STATE.participants.find(i => i.id === pId);
    if (!p) return;

    // --- SUNTIKAN PERBAIKAN (REVISI): PAKSA GAMBAR KOTAK JIKA MASIH KOSONG ---
    const judgeContainerFix = document.getElementById('judge-inputs');
    if (judgeContainerFix && judgeContainerFix.innerHTML.trim() === '') {
        // Menggunakan nama variabel baru (safeJudgesCount) agar tidak error
        const safeJudgesCount = parseInt(localStorage.getItem('local_judges')) || 5;
        setJudges(safeJudgesCount);
    }
    // ----------------------------------------------------------------

    // Sapu Bersih 5 Kotak (Kode asli Anda berlanjut di bawah ini...)
    for (let i = 1; i <= 5; i++) {
        let sEl = document.getElementById(`score-${i}`);
        let tEl = document.getElementById(`tech-${i}`);
        if (sEl) sEl.value = '';
        if (tEl) tEl.value = '';
    }
    const scoreData = p.scores[babak];
    let currentLocalJudges = parseInt(localStorage.getItem('local_judges')) || 5;

    // Sapu Bersih 5 Kotak
    for (let i = 1; i <= 5; i++) {
        let sEl = document.getElementById(`score-${i}`);
        let tEl = document.getElementById(`tech-${i}`);
        if (sEl) sEl.value = '';
        if (tEl) tEl.value = '';
    }

    if (scoreData && scoreData.raw && scoreData.raw.length > 0) {
        const nJudges = scoreData.raw.length;
        if (currentLocalJudges !== nJudges) setJudges(nJudges); // Jika mau edit nilai lama, sesuaikan kotaknya
        for (let i = 1; i <= nJudges; i++) {
            let sEl = document.getElementById(`score-${i}`); let tEl = document.getElementById(`tech-${i}`);
            if (sEl) sEl.value = scoreData.raw[i - 1] || '';
            if (tEl) tEl.value = (scoreData.techRaw && scoreData.techRaw[i - 1]) ? scoreData.techRaw[i - 1] : '';
        }
        UI.timerSeconds = scoreData.time || 0; updateTimerUI();
    } else {
        UI.timerSeconds = 0; updateTimerUI();
        setJudges(currentLocalJudges); // Kembalikan ke setingan lokal laptop untuk atlet baru
    }
    calculateLive();
}

function calculateLive() {
    let raw = [];
    let techRaw = [];

    // Deteksi jumlah wasit berdasarkan KOTAK FISIK di layar
    let actualJudges = 0;
    for (let i = 1; i <= 5; i++) {
        if (document.getElementById(`score-${i}`)) actualJudges++;
    }

    // 1. Ambil nilai total & nilai teknik
    for (let i = 1; i <= actualJudges; i++) {
        let sEl = document.getElementById(`score-${i}`);
        let tEl = document.getElementById(`tech-${i}`);
        raw.push(sEl && sEl.value !== '' ? parseFloat(sEl.value) : 0);
        techRaw.push(tEl && tEl.value !== '' ? parseFloat(tEl.value) : 0);
    }

    let validIndices = [];
    for (let i = 0; i < actualJudges; i++) validIndices.push(i);

    // 2. PEMOTONGAN SKOR (5 Wasit -> Buang 1 Min & 1 Max)
    if (actualJudges === 5 && raw.length === 5) {
        let minVal = Math.min(...raw);
        let maxVal = Math.max(...raw);

        let minIdx = raw.indexOf(minVal);
        let maxIdx = -1;
        // Cari maxIdx yang tidak bertabrakan dengan minIdx jika nilainya sama
        for (let i = 0; i < raw.length; i++) {
            if (raw[i] === maxVal && i !== minIdx) { maxIdx = i; break; }
        }
        if (maxIdx === -1) maxIdx = raw.lastIndexOf(maxVal);

        validIndices = validIndices.filter(idx => idx !== minIdx && idx !== maxIdx);
    }

    // 3. KALKULASI TOTAL NILAI & TIE-BREAKER
    let totalRaw = validIndices.reduce((sum, idx) => sum + (raw[idx] || 0), 0);

    // 🔥 LEVEL 1: Nilai Teknik Wasit 1 (Wasit Utama) Murni
    let tb1 = techRaw[0] || 0;

    // 🔥 LEVEL 2: Jumlah Nilai Teknik dari Wasit-Wasit Sah (Tidak Dicoret)
    let tb2 = validIndices.reduce((sum, idx) => sum + (techRaw[idx] || 0), 0);

    // 4. KALKULASI PENALTI WAKTU (Hanya potong totalRaw, tidak potong tb1 / tb2)
    let penalty = 0;
    let val = document.getElementById('select-peserta').value;
    let targetPId = null;

    if (val) {
        if (val.includes('|')) targetPId = parseInt(val.split('|')[0]);
        else if (val.startsWith('h2h-match-')) targetPId = parseInt(val.split('-')[4]);
    }

    if (targetPId !== null) {
        let p = STATE.participants.find(x => x.id === targetPId);
        if (p && UI.timerSeconds > 0) {
            let rule = getEmbuTimeRule(p.kategori);
            let minTime = rule.min;
            let maxTime = rule.max;
            if (minTime > 0 && maxTime > 0) {
                if (UI.timerSeconds < minTime) penalty = Math.ceil((minTime - UI.timerSeconds) / 5) * 5;
                else if (UI.timerSeconds > maxTime) penalty = Math.ceil((UI.timerSeconds - maxTime) / 5) * 5;
            }
        }
    }

    let finalScore = totalRaw - penalty;

    // 5. UPDATE UI
    let scoreEl = document.getElementById('live-final-score');
    let penEl = document.getElementById('live-penalty');
    if (scoreEl) scoreEl.innerText = finalScore.toFixed(1);
    if (penEl) penEl.innerText = `Penalti Waktu: ${penalty}`;

    // Sensor Buka Kunci Tombol Simpan
    let filledCount = 0;
    for (let i = 1; i <= actualJudges; i++) {
        let sEl = document.getElementById(`score-${i}`);
        if (sEl && sEl.value.trim() !== "") filledCount++;
    }

    let isComplete = (filledCount === actualJudges && actualJudges > 0);
    const saveBtns = [document.getElementById("btn-save-b1"), document.getElementById("btn-save-b2")];

    saveBtns.forEach(btn => {
        if (btn && !btn.classList.contains('hidden')) {
            if (isComplete) {
                btn.disabled = false;
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
                btn.classList.add('animate-pulse');
            } else {
                if (typeof isWasitDigitalMode !== 'undefined' && isWasitDigitalMode) {
                    btn.disabled = true;
                    btn.classList.add('opacity-50', 'cursor-not-allowed');
                }
                btn.classList.remove('animate-pulse');
            }
        }
    });

    let isTechFilled = techRaw.some(t => t > 0);

    return {
        raw: raw,
        techRaw: techRaw,
        penalty: penalty,
        final: finalScore,
        tb1: tb1,
        tb2: tb2,
        validIndices: validIndices,
        isTechFilled: isTechFilled
    };
}

// =========================================================
// MODAL ESTETIK TIE-BREAKER H2H (ANNOUNCER READY)
// =========================================================
function showTieBreakerModalH2H(m, mrh, pth, tbData, onConfirmDecision) {
    let oldModal = document.getElementById('modal-tie-breaker-h2h');
    if (oldModal) oldModal.remove();

    let displayNum = m.matchNum % 50 === 0 ? 50 : m.matchNum % 50;
    let isLevel1 = tbData.level === 1;
    let isLevel2 = tbData.level === 2;
    let isDeadlock = tbData.level === 3;

    let winnerCornerText = tbData.winner === 'merah' ? 'PITA MERAH' : 'PITA PUTIH';
    let winnerName = tbData.winner === 'merah' ? `${mrh.nama} (${mrh.kontingen})` : `${pth.nama} (${pth.kontingen})`;

    // Naskah Siap Baca untuk MC / Announcer Lapangan
    let mcNarration = "";
    if (!isDeadlock) {
        let alasanTeks = isLevel1 
            ? `Keunggulan Nilai Teknik Wasit Utama (${tbData.winnerVal.toFixed(1)} vs ${tbData.loserVal.toFixed(1)})` 
            : `Keunggulan Total Nilai Teknik Wasit Sah (${tbData.winnerVal.toFixed(1)} vs ${tbData.loserVal.toFixed(1)})`;
        mcNarration = `📢 "Partai G-${displayNum} (${m.kategori}) dinyatakan SERI pada Total Nilai Bersih (${m.skorMerah.toFixed(1)}). Berdasarkan regulasi MASS KEMPO, kemenangan diberikan kepada ${winnerCornerText} [${winnerName}] berdasarkan ${alasanTeks}."`;
    } else {
        mcNarration = `⚠️ "Partai G-${displayNum} (${m.kategori}) dinyatakan SERI KEDATON (Total Nilai & Seluruh Nilai Teknik Sama Persis: ${m.skorMerah.toFixed(1)}). Pemenang ditentukan melalui KEPUTUSAN DEWAN HAKIM / VOTING WASIT."`;
    }

    let modalHTML = `
    <div id="modal-tie-breaker-h2h" class="fixed inset-0 z-[150] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
        <div class="bg-slate-900 border-2 border-yellow-500/80 rounded-2xl max-w-2xl w-full p-6 shadow-[0_0_50px_rgba(234,179,8,0.3)] flex flex-col gap-4 text-white">
            
            <!-- HEADER -->
            <div class="flex items-center justify-between border-b border-slate-700/80 pb-3">
                <div class="flex items-center gap-3">
                    <span class="bg-yellow-500 text-slate-950 text-[10px] font-black px-3 py-1 rounded-md tracking-widest uppercase shadow">TIE-BREAKER PROTOCOL</span>
                    <h2 class="text-sm font-black text-slate-200">PARTAI G-${displayNum} &bull; ${m.kategori}</h2>
                </div>
                <span class="text-xs font-mono text-yellow-400 font-bold bg-yellow-950/40 px-2.5 py-1 rounded border border-yellow-800">SKOR SERI: ${m.skorMerah.toFixed(1)}</span>
            </div>

            <!-- KOMPARASI ATLET -->
            <div class="grid grid-cols-2 gap-3">
                <div class="bg-slate-950 p-3 rounded-xl border ${tbData.winner === 'merah' ? 'border-red-500 ring-2 ring-red-500/40' : 'border-slate-800'}">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-[9px] font-black px-2 py-0.5 rounded bg-red-600 text-white uppercase">PITA MERAH</span>
                        ${tbData.winner === 'merah' ? '<span class="text-[10px] text-yellow-400 font-black tracking-wider"><i class="fas fa-crown mr-1"></i>PEMENANG</span>' : ''}
                    </div>
                    <div class="font-bold text-white text-xs truncate">${mrh.nama}</div>
                    <div class="text-[10px] text-slate-400 uppercase font-bold">${mrh.kontingen}</div>
                </div>

                <div class="bg-slate-950 p-3 rounded-xl border ${tbData.winner === 'putih' ? 'border-blue-400 ring-2 ring-blue-400/40' : 'border-slate-800'}">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-[9px] font-black px-2 py-0.5 rounded bg-slate-200 text-slate-900 uppercase">PITA PUTIH</span>
                        ${tbData.winner === 'putih' ? '<span class="text-[10px] text-yellow-400 font-black tracking-wider"><i class="fas fa-crown mr-1"></i>PEMENANG</span>' : ''}
                    </div>
                    <div class="font-bold text-white text-xs truncate">${pth.nama}</div>
                    <div class="text-[10px] text-slate-400 uppercase font-bold">${pth.kontingen}</div>
                </div>
            </div>

            <!-- TABEL AUDIT HIRARKI -->
            <div class="flex flex-col gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs">
                <!-- TINGKAT 1 -->
                <div class="flex items-center justify-between p-2.5 rounded-lg border ${isLevel1 ? 'bg-yellow-950/30 border-yellow-500/80 shadow' : 'bg-slate-900/60 border-slate-800'}">
                    <div>
                        <div class="font-bold text-slate-200">TINGKAT 1: Nilai Teknik Wasit 1 (Wasit Utama)</div>
                        <div class="text-[10px] text-slate-500">Nilai murni teknik Wasit 1 (tidak terpengaruh pemotongan skor min/max)</div>
                    </div>
                    <div class="flex items-center gap-3 font-mono font-bold text-sm">
                        <span class="text-red-400">${tbData.tb1Merah.toFixed(1)}</span>
                        <span class="text-slate-600 text-xs">vs</span>
                        <span class="text-slate-200">${tbData.tb1Putih.toFixed(1)}</span>
                        ${isLevel1 ? '<span class="bg-emerald-600 text-white text-[9px] font-black px-2 py-0.5 rounded shadow">PENENTU</span>' : ''}
                    </div>
                </div>

                <!-- TINGKAT 2 -->
                <div class="flex items-center justify-between p-2.5 rounded-lg border ${isLevel2 ? 'bg-yellow-950/30 border-yellow-500/80 shadow' : 'bg-slate-900/60 border-slate-800'}">
                    <div>
                        <div class="font-bold text-slate-200">TINGKAT 2: Total Nilai Teknik Wasit Sah</div>
                        <div class="text-[10px] text-slate-500">Akumulasi nilai teknik dari 3 wasit yang total nilainya sah (tidak dicoret)</div>
                    </div>
                    <div class="flex items-center gap-3 font-mono font-bold text-sm">
                        <span class="text-red-400">${tbData.tb2Merah.toFixed(1)}</span>
                        <span class="text-slate-600 text-xs">vs</span>
                        <span class="text-slate-200">${tbData.tb2Putih.toFixed(1)}</span>
                        ${isLevel2 ? '<span class="bg-emerald-600 text-white text-[9px] font-black px-2 py-0.5 rounded shadow">PENENTU</span>' : ''}
                    </div>
                </div>
            </div>

            <!-- KOTAK NASKAH MC -->
            <div class="bg-slate-800/80 border border-slate-700 p-3 rounded-xl">
                <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                    <i class="fas fa-bullhorn text-yellow-400"></i> TEKS PENGUMUMAN MC / ANNOUNCER (SIAP BACA):
                </div>
                <div class="text-xs text-slate-200 leading-relaxed italic bg-slate-900/80 p-2.5 rounded border border-slate-800 select-all font-mono">${mcNarration}</div>
            </div>

            <!-- TOMBOL AKSI -->
            <div class="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
                <button onclick="document.getElementById('modal-tie-breaker-h2h').remove()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 px-4 rounded-xl text-xs transition-colors border border-slate-600">
                    <i class="fas fa-edit mr-1"></i> Koreksi Nilai Kertas
                </button>

                ${!isDeadlock ? `
                    <button id="btn-confirm-tie-winner" class="bg-emerald-600 hover:bg-emerald-500 text-white font-black py-2.5 px-6 rounded-xl text-xs transition-transform hover:scale-105 shadow-lg flex items-center gap-2">
                        <i class="fas fa-check-circle"></i> TETAPKAN & TAYANGKAN (${winnerCornerText})
                    </button>
                ` : `
                    <button onclick="window.resolveTieDeadlock('merah')" class="bg-red-600 hover:bg-red-500 text-white font-black py-2.5 px-4 rounded-xl text-xs shadow">
                        <i class="fas fa-gavel mr-1"></i> Menangkan Merah (Voting)
                    </button>
                    <button onclick="window.resolveTieDeadlock('putih')" class="bg-slate-200 hover:bg-white text-slate-900 font-black py-2.5 px-4 rounded-xl text-xs shadow">
                        <i class="fas fa-gavel mr-1"></i> Menangkan Putih (Voting)
                    </button>
                `}
            </div>
        </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const btnConfirm = document.getElementById('btn-confirm-tie-winner');
    if (btnConfirm) {
        btnConfirm.onclick = () => {
            document.getElementById('modal-tie-breaker-h2h').remove();
            onConfirmDecision(tbData.winner);
        };
    }

    window.resolveTieDeadlock = (votedWinner) => {
        document.getElementById('modal-tie-breaker-h2h').remove();
        onConfirmDecision(votedWinner);
    };
}

function toggleTimer() {
    const btnStart = document.getElementById('btn-timer-start');

    if (UI.isTimerRunning) {
        // PAUSE TIMER
        clearInterval(UI.timerInterval);
        UI.timerInterval = null;
        UI.isTimerRunning = false;
        if (btnStart) {
            btnStart.innerText = 'START';
            btnStart.className = "bg-green-600 hover:bg-green-500 text-white font-black py-3 px-6 rounded-xl transition-all shadow-md";
        }
    } else {
        // START TIMER
        UI.isTimerRunning = true;
        if (btnStart) {
            btnStart.innerText = 'STOP';
            btnStart.className = "bg-red-600 hover:bg-red-500 text-white font-black py-3 px-6 rounded-xl transition-all shadow-md animate-pulse";
        }

        UI.timerInterval = setInterval(() => {
            if (UI.isCountdown) {
                // ⏱️ MODE RANDORI: Berkurang tiap detik sampai 0
                if (UI.timerSeconds > 0) {
                    UI.timerSeconds--;
                } else {
                    // Waktu Randori Habis
                    clearInterval(UI.timerInterval);
                    UI.timerInterval = null;
                    UI.isTimerRunning = false;
                    if (btnStart) {
                        btnStart.innerText = 'SELESAI';
                        btnStart.className = "bg-slate-700 text-slate-400 font-black py-3 px-6 rounded-xl cursor-not-allowed";
                    }
                    if (typeof playBuzzerSound === 'function') playBuzzerSound();
                }
            } else {
                // ⏱️ MODE EMBU (H2H / BAKU / FESTIVAL): Bertambah terus dari 00:00
                UI.timerSeconds++;
            }

            // Update UI Laptop
            const timerDisplay = document.getElementById('master-timer') || document.getElementById('live-timer');
            if (timerDisplay) {
                let m = Math.floor(UI.timerSeconds / 60).toString().padStart(2, '0');
                let s = (UI.timerSeconds % 60).toString().padStart(2, '0');
                timerDisplay.innerText = `${m}:${s}`;
            }

            // Push Realtime ke TV Display Randori
            if (UI.isCountdown && typeof pushRandoriToTV === 'function') {
                pushRandoriToTV();
            }

            // Kalkulasi ulang live score (penalti waktu otomatis jika Embu)
            if (!UI.isCountdown && typeof calculateLive === 'function') {
                calculateLive();
            }
        }, 1000);
    }
}

function resetTimer() {
    clearInterval(UI.timerInterval);
    UI.timerInterval = null;
    UI.isTimerRunning = false;

    // 1. Reset Tampilan Tombol START
    const btnStart = document.getElementById('btn-timer-start');
    if (btnStart) {
        btnStart.innerText = 'START';
        btnStart.className = "bg-green-600 hover:bg-green-500 text-white font-black py-3 px-6 rounded-xl transition-all shadow-md";
    }

    // 2. DETEKSI NILAI DROPDOWN & DISIPLIN KATEGORI
    const val = document.getElementById('select-peserta') ? document.getElementById('select-peserta').value : '';
    let isRandori = false;
    let targetCatName = '';

    if (val) {
        // 🔥 Format 1: Randori Panel (match-ID)
        if (val.startsWith('match-')) {
            isRandori = true;
            const matchId = parseInt(val.split('-')[1]);
            const m = STATE.matches.find(x => x.id === matchId);
            if (m) targetCatName = m.kategori;
        
        // 🔥 Format 2: H2H Match (h2h-match-ID-CORNER-PID)
        } else if (val.startsWith('h2h-match-')) {
            const matchId = parseInt(val.split('-')[2]);
            const m = STATE.matches.find(x => x.id === matchId);
            if (m) {
                targetCatName = m.kategori;
                const catObj = STATE.categories.find(c => c.name === m.kategori);
                if (catObj && catObj.discipline === 'randori') isRandori = true;
            }
        
        // 🔥 Format 3: Embu Baku / Festival (PID|BABAK)
        } else if (val.includes('|')) {
            isRandori = false;
        }
    }

    // 3. SETEL NILAI DETIK AWAL & ARAH HITUNGAN
    if (isRandori) {
        // 🥋 RANDORI: Hitung Mundur (Default 120 Detik / 2 Menit)
        let duration = 120;
        if (typeof getRandoriTimeRule === 'function' && targetCatName) {
            duration = getRandoriTimeRule(targetCatName) || 120;
        }
        UI.timerSeconds = duration;
        UI.isCountdown = true;
    } else {
        // 🥋 EMBU (H2H / BAKU / FESTIVAL): Hitung Maju (Mulai 00:00)
        UI.timerSeconds = 0;
        UI.isCountdown = false;
    }

    // 4. Update Angka Timer di Layar Laptop Panitera
    const timerDisplay = document.getElementById('master-timer') || document.getElementById('live-timer');
    if (timerDisplay) {
        let m = Math.floor(UI.timerSeconds / 60).toString().padStart(2, '0');
        let s = (UI.timerSeconds % 60).toString().padStart(2, '0');
        timerDisplay.innerText = `${m}:${s}`;
    }

    // 5. Sinkronkan ke Layar TV jika Randori sedang Live
    if (isRandori && typeof pushRandoriToTV === 'function') {
        pushRandoriToTV();
    }
}

// =========================================================
// FIX FINAL: TIMER & SAVE SCORE (Gembok Anti-Spam Klik)
// =========================================================

let isSaving = false; // <-- GEMBOK KEAMANAN GLOBAL

// =========================================================
// MESIN SIMPAN NILAI UTAMA (H2H, BAKU, FESTIVAL) - ZERO BUG
// =========================================================
async function saveScore() {
    const val = document.getElementById('select-peserta').value;
    const activeMode = SYSTEM_MODE.toLowerCase();

    // =========================================================
    // 1. LOGIKA PENYIMPANAN EMBU H2H (DOUBLE ELIMINATION)
    // =========================================================
    if (val && val.startsWith('h2h-match-')) {
        if (isSaving) return;
        const parts = val.split('-');
        const matchId = parseInt(parts[2]);
        const corner = parts[3];
        const pId = parseInt(parts[4]);

        let currentLocalJudges = parseInt(localStorage.getItem('local_judges')) || 5;
        for (let i = 1; i <= currentLocalJudges; i++) {
            let sEl = document.getElementById(`score-${i}`);
            if (sEl && sEl.value === "") return alert(`TOTAL NILAI Wasit ${i} kosong!`);
        }

        const calc = calculateLive();
        const match = STATE.matches.find(m => m.id === matchId);
        const p = STATE.participants.find(x => x.id === pId);
        if (!match || !p) return;

        if (confirm(`Konfirmasi Nilai Final PITA ${corner.toUpperCase()} (${p.nama})\nNilai Akhir: ${calc.final.toFixed(2)}\n\nLanjutkan?`)) {
            isSaving = true;
            document.body.style.cursor = 'wait';

            // Kumpulkan nama wasit tugas
            let wasitNames = [];
            for (let i = 1; i <= currentLocalJudges; i++) {
                let wasitSelect = document.getElementById(`pilih-w${i}`);
                let wName = "Wasit " + i;
                if (wasitSelect && wasitSelect.value) {
                    wName = wasitSelect.options[wasitSelect.selectedIndex].text.split('(')[0].trim();
                }
                wasitNames.push(wName);
            }

            // 1. PENGAMAN ANTI-UNDEFINED NILAI TEKNIK & TIE-BREAKER[cite: 1, 3]
            let safeTB1 = (calc.tb1 !== undefined) ? calc.tb1 : (calc.tieBreaker !== undefined ? calc.tieBreaker : 0);
            let safeTB2 = (calc.tb2 !== undefined) ? calc.tb2 : 0;

            if (corner === 'merah') {
                match.skorMerah = Number(calc.final) || 0;
                match.tbMerahW1 = safeTB1; // Tingkat 1 (Wasit Utama)[cite: 1, 3]
                match.tb2Merah = safeTB2;  // Tingkat 2 (Total 3 Wasit Sah)[cite: 1, 3]
                match.rawMerah = calc.raw || [];
                match.techRawMerah = calc.techRaw || [];
                match.penaltyMerah = Number(calc.penalty) || 0;
                match.waktuMerah = Number(UI.timerSeconds) || 0;
                match.petugasMerah = wasitNames || [];
            } else {
                match.skorPutih = Number(calc.final) || 0;
                match.tbPutihW1 = safeTB1; // Tingkat 1 (Wasit Utama)[cite: 1, 3]
                match.tb2Putih = safeTB2;  // Tingkat 2 (Total 3 Wasit Sah)[cite: 1, 3]
                match.rawPutih = calc.raw || [];
                match.techRawPutih = calc.techRaw || [];
                match.penaltyPutih = Number(calc.penalty) || 0;
                match.waktuPutih = Number(UI.timerSeconds) || 0;
                match.petugasPutih = wasitNames || [];
            }

            let updates = {};
            let matchSiapDiumumkan = false;

            // 2. CEK KESIAPAN PENGUMUMAN (KEDUA SUDUT SUDAH DINILAI)[cite: 1, 3]
            if (match.skorMerah > 0 && match.skorPutih > 0) {
                matchSiapDiumumkan = true;
                HOLD_H2H_SCREEN = true; // Kunci gembok agar dropdown tidak berkedip[cite: 1, 3]

                // Jika skor kembar tetapi nilai teknik masih kosong (karena input manual cepat)
                let tb1M = match.tbMerahW1 || 0;
                let tb1P = match.tbPutihW1 || 0;
                let tb2M = match.tb2Merah || 0;
                let tb2P = match.tb2Putih || 0;

                if (match.skorMerah === match.skorPutih && (tb1M === 0 && tb1P === 0 && tb2M === 0 && tb2P === 0)) {
                    alert(`⚠️ SKOR SERI TERDETEKSI (${match.skorMerah})!\n\nNilai total Merah dan Putih kembar. Pastikan kolom NILAI TEKNIK pada form kertas sudah terisi agar audit Tie-Breaker berjalan akurat saat menekan tombol Juara.`);
                }
            }

            let mIdx = STATE.matches.findIndex(m => m.id === matchId);
            if (mIdx > -1) {
                updates[`turnamen_data/matches/${mIdx}`] = match;
            }

            try {
                // A. SIMPAN KE LOKAL (SQLITE UTAMA + AUDIT TRAIL)[cite: 1, 3]
                if (activeMode === 'local' || activeMode === 'lokal' || activeMode === 'hybrid') {
                    saveToLocalStorage(); //[cite: 1, 3]

                    let currentLocalJudges = parseInt(localStorage.getItem('local_judges')) || 5;
                    const safeCourtId = typeof DEVICE_ROLE !== 'undefined' && DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';

                    for (let i = 1; i <= currentLocalJudges; i++) {
                        let sEl = document.getElementById(`score-${i}`);
                        let tEl = document.getElementById(`tech-${i}`);

                        if (sEl && sEl.value !== "") {
                            let wasitSelect = document.getElementById(`pilih-w${i}`);
                            let realName = "WASIT " + i;
                            let realId = "TIDAK_DIKETAHUI";

                            if (wasitSelect && wasitSelect.value) {
                                realName = wasitSelect.options[wasitSelect.selectedIndex].text.split('(')[0].trim();
                                realId = wasitSelect.value;
                            }

                            let isManual = !TEMP_RINCIAN_WASIT[i];
                            let rincianVal = isManual ? "DIKETIK_MANUAL_PANITERA" : TEMP_RINCIAN_WASIT[i];
                            let finalNamaWasit = isManual ? "PANITERA LAPANGAN" : realName;
                            let finalShortId = isManual ? "BYPASS" : realId;

                            fetch('/api/save_score', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    partai_id: val,
                                    court: safeCourtId, 
                                    juri_index: i,
                                    rincian: rincianVal,
                                    nilai_teknik: parseFloat(tEl ? tEl.value : 0) || 0,
                                    nilai_total: parseFloat(sEl.value) || 0,
                                    nama_wasit: finalNamaWasit,
                                    short_id_wasit: finalShortId
                                })
                            }).catch(e => console.error("Gagal simpan jejak audit:", e));
                        }
                    }
                }

                // B. SIMPAN KE FIREBASE (FIRESTORE & RTDB)[cite: 1, 3]
                if (database && (activeMode === 'hybrid' || activeMode === 'firebase')) {
                    const safeCourtId = typeof DEVICE_ROLE !== 'undefined' && DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';
                    const partaiDocId = `h2h_${p.kategori.replace(/\s+/g, '_')}_${match.id}_${corner}`;

                    if (typeof firebase !== 'undefined' && firebase.apps.length > 0 && firebase.firestore) {
                        firebase.firestore().collection('hasil_rincian_embu').doc(partaiDocId).set({
                            waktu_simpan: firebase.firestore.FieldValue.serverTimestamp(),
                            court: safeCourtId, 
                            kategori: p.kategori, 
                            atlet: p.nama,
                            kontingen: p.kontingen, 
                            babak: match.babak, 
                            corner: corner,
                            rincian_juri: TEMP_RINCIAN_WASIT || {}, 
                            total_nilai: calc.final, 
                            total_teknik: safeTB1
                        }, { merge: true }).catch(e => console.warn("Firestore sync tertunda.", e));
                    }

                    database.ref(`live_embu/${safeCourtId}/juri`).set(null).catch(e => console.warn(e));
                    TEMP_RINCIAN_WASIT = {};
                    database.ref().update(updates).catch(e => console.warn("RTDB sync tertunda.", e));
                }

                // C. TAYANGKAN HASIL NILAI SUDUT KE TV DISPLAY (SCORE VIEW)[cite: 1, 3]
                if (typeof IS_TV_LIVE !== 'undefined' && IS_TV_LIVE && DEVICE_ROLE !== 'admin') {
                    let namesTV = String(p.nama).split(/[,+&]/).map(n => n.trim()).filter(n => n);
                    let tvNamaLengkap = namesTV.join(" & ");
                    let finalTimeSec = UI.timerSeconds || 0;
                    let timerFmt = `${Math.floor(finalTimeSec / 60).toString().padStart(2, '0')}:${(finalTimeSec % 60).toString().padStart(2, '0')}`;

                    let payloadScore = {
                        payload_id: Date.now().toString() + "-" + Math.floor(Math.random() * 10000),
                        type: 'embu',
                        current_action: 'show_score',
                        score_data: {
                            kategori: p.kategori,
                            nama: tvNamaLengkap,
                            kontingen: p.kontingen,
                            rawScores: calc.raw,
                            techScores: calc.techRaw,
                            waktu: timerFmt,
                            denda: calc.penalty,
                            nilaiAkhir: calc.final,
                            pita: corner
                        }
                    };
                    if (database) database.ref(`live_broadcast/${DEVICE_ROLE}`).set(payloadScore).catch(e => console.warn(e));
                    if (typeof localSocket !== 'undefined' && localSocket) {
                        localSocket.emit('broadcast_to_tv', { channel: 'global_tv', court: DEVICE_ROLE, payload: payloadScore });
                    }
                }

                // D. RESET FORM INPUT & KENDALI TOMBOL EMAS JUARA[cite: 1, 3]
                isSaving = false;
                document.body.style.cursor = 'default';
                resetTimer(); //[cite: 1, 3]

                if (matchSiapDiumumkan) {
                    const btnWinner = document.getElementById('btn-tampil-pemenang-h2h');
                    if (btnWinner) {
                        btnWinner.classList.remove('hidden');
                        btnWinner.className = "bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-400 hover:to-amber-400 text-slate-950 font-black py-3.5 px-8 rounded-xl transition-transform hover:scale-105 shadow-[0_0_25px_rgba(234,179,8,0.5)] tracking-widest text-sm whitespace-nowrap ml-3 flex items-center h-12 animate-pulse";
                        btnWinner.innerHTML = '<i class="fas fa-gavel mr-2.5"></i> KEPUTUSAN FINAL';
                    }
                } else {
                    filterPesertaScoring();
                    let selectEl = document.getElementById('select-peserta');
                    if (selectEl && selectEl.selectedIndex < selectEl.options.length - 1) {
                        selectEl.selectedIndex++;
                        updateScoringButtonsUI(); //[cite: 1, 3]
                    }
                }
            } catch (err) {
                isSaving = false; 
                document.body.style.cursor = 'default';
                alert("Gagal Simpan: " + err);
            }
        }
        return;
    }

    // =========================================================
    // 2. LOGIKA PENYIMPANAN EMBU FESTIVAL / BAKU / EKSIBISI
    // =========================================================
    if (!val || !val.includes('|')) return alert('Pilih atlet dari dropdown terlebih dahulu!');
    const [pIdStr, babak] = val.split('|');
    const pId = parseInt(pIdStr);

    let currentLocalJudges = parseInt(localStorage.getItem('local_judges')) || 5;
    for (let i = 1; i <= currentLocalJudges; i++) {
        let sEl = document.getElementById(`score-${i}`);
        if (sEl && sEl.value === "") return alert(`TOTAL NILAI Wasit ${i} kosong!`);
    }

    const calc = calculateLive();
    const pIndex = STATE.participants.findIndex(i => i.id === pId);
    const p = STATE.participants[pIndex];

    let safeTB1 = (calc.tb1 !== undefined) ? calc.tb1 : (calc.tieBreaker !== undefined ? calc.tieBreaker : 0);
    let safeTB2 = (calc.tb2 !== undefined) ? calc.tb2 : 0;

    p.scores[babak] = {
        raw: calc.raw || [],
        techRaw: calc.techRaw || [],
        penalty: Number(calc.penalty) || 0,
        final: Number(calc.final) || 0,
        tech: safeTB2,
        time: Number(UI.timerSeconds) || 0
    };

    let catObj = STATE.categories.find(c => c.name === p.kategori);
    let minPeserta = (STATE.settings && STATE.settings.minPesertaJuara) ? parseInt(STATE.settings.minPesertaJuara) : 1;
    let catParts = STATE.participants.filter(x => x.kategori === p.kategori);
    let isEksibisi = (catObj.discipline === 'embu' && catParts.length < minPeserta && STATE.settings && STATE.settings.eksibisiLangsungFinal === true);

    if (p.isFinalist) {
        p.finalScore = p.scores.b2.final;
        p.techScore = p.scores.b2.tech;
    } else if (p.pool !== '-' && p.pool !== 'SINGLE') {
        p.finalScore = p.scores.b1.final;
        p.techScore = p.scores.b1.tech;
    } else {
        if (isEksibisi) {
            p.finalScore = p.scores.b1.final;
            p.techScore = p.scores.b1.tech;
        } else if (p.scores.b1.final > 0 && p.scores.b2.final > 0) {
            p.finalScore = (p.scores.b1.final + p.scores.b2.final) / 2;
            p.techScore = (p.scores.b1.tech + p.scores.b2.tech) / 2;
        } else {
            p.finalScore = p.scores[babak].final;
            p.techScore = p.scores[babak].tech;
        }
    }

    let updates = {};
    updates[`turnamen_data/participants/${pIndex}`] = p;

    if (isEksibisi) {
        let allDone = catParts.every(x => x.id === p.id ? calc.final > 0 : x.scores.b1.final > 0);
        if (allDone) {
            let catIdx = STATE.categories.findIndex(c => c.name === p.kategori);
            if (catIdx > -1) {
                STATE.categories[catIdx].status = 'completed';
                updates[`turnamen_data/categories/${catIdx}/status`] = 'completed';
            }
        }
    }

    isSaving = true;
    document.body.style.cursor = 'wait';

    try {
        // A. SIMPAN KE LOKAL (SQLITE UTAMA + JEJAK AUDIT PANITERA)
        if (activeMode === 'local' || activeMode === 'lokal' || activeMode === 'hybrid') {
            saveToLocalStorage();

            let currentLocalJudges = parseInt(localStorage.getItem('local_judges')) || 5;
            const safeCourtId = typeof DEVICE_ROLE !== 'undefined' && DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';

            for (let i = 1; i <= currentLocalJudges; i++) {
                let sEl = document.getElementById(`score-${i}`);
                let tEl = document.getElementById(`tech-${i}`);

                if (sEl && sEl.value !== "") {
                    let wasitSelect = document.getElementById(`pilih-w${i}`);
                    let realName = "WASIT " + i;
                    let realId = "TIDAK_DIKETAHUI";

                    if (wasitSelect && wasitSelect.value) {
                        realName = wasitSelect.options[wasitSelect.selectedIndex].text.split('(')[0].trim();
                        realId = wasitSelect.value;
                    }

                    let isManual = !TEMP_RINCIAN_WASIT[i];
                    let rincianVal = isManual ? "DIKETIK_MANUAL_PANITERA" : TEMP_RINCIAN_WASIT[i];
                    let finalNamaWasit = isManual ? "PANITERA LAPANGAN" : realName;
                    let finalShortId = isManual ? "BYPASS" : realId;

                    fetch('/api/save_score', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            partai_id: val,
                            court: safeCourtId,
                            juri_index: i,
                            rincian: rincianVal,
                            nilai_teknik: parseFloat(tEl ? tEl.value : 0) || 0,
                            nilai_total: parseFloat(sEl.value) || 0,
                            nama_wasit: finalNamaWasit,
                            short_id_wasit: finalShortId
                        })
                    }).catch(e => console.error("Gagal simpan jejak audit:", e));
                }
            }
            console.log("✅ Nilai Festival/Baku berhasil disimpan permanen ke database utama SQLite");
        }

        // B. SIMPAN KE FIREBASE (FIRESTORE & RTDB)
        if (database && (activeMode === 'hybrid' || activeMode === 'firebase')) {
            const safeCourtId = typeof DEVICE_ROLE !== 'undefined' && DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';
            const partaiDocId = `embu_${p.kategori.replace(/\s+/g, '_')}_${pId}_${babak}`;

            if (typeof firebase !== 'undefined' && firebase.apps.length > 0 && firebase.firestore) {
                const firestorePayload = {
                    waktu_simpan: firebase.firestore.FieldValue.serverTimestamp(),
                    court: safeCourtId,
                    kategori: p.kategori,
                    atlet: p.nama,
                    kontingen: p.kontingen,
                    babak: babak,
                    rincian_juri: TEMP_RINCIAN_WASIT || {},
                    total_nilai: calc.final,
                    total_teknik: safeTB1
                };

                firebase.firestore().collection('hasil_rincian_embu').doc(partaiDocId).set(firestorePayload, { merge: true })
                    .catch(e => console.warn("Firestore background sync tertunda.", e));
            }

            database.ref(`live_embu/${safeCourtId}/juri`).set(null).catch(e => console.warn(e));
            TEMP_RINCIAN_WASIT = {};

            // C. SUNTIKAN TV DISPLAY (BAKU / FESTIVAL)
            if (typeof IS_TV_LIVE !== 'undefined' && IS_TV_LIVE && DEVICE_ROLE !== 'admin') {
                let namesTV = String(p.nama).split(/[,+&]/).map(n => n.trim()).filter(n => n);
                let tvNamaLengkap = namesTV.join(" & ");
                let finalTimeSec = UI.timerSeconds || 0;
                let timerFmt = `${Math.floor(finalTimeSec / 60).toString().padStart(2, '0')}:${(finalTimeSec % 60).toString().padStart(2, '0')}`;

                let payloadScore = {
                    payload_id: Date.now().toString() + "-SCORE-" + Math.floor(Math.random() * 10000),
                    type: 'embu',
                    current_action: 'show_score',
                    score_data: {
                        kategori: p.kategori,
                        nama: tvNamaLengkap,
                        kontingen: p.kontingen,
                        rawScores: calc.raw,
                        techScores: calc.techRaw,
                        waktu: timerFmt,
                        denda: calc.penalty,
                        nilaiAkhir: calc.final,
                        pita: 'baku'
                    }
                };

                if (database) database.ref(`live_broadcast/${DEVICE_ROLE}`).set(payloadScore).catch(e => console.warn(e));
                if (typeof localSocket !== 'undefined' && localSocket) {
                    localSocket.emit('broadcast_to_tv', { channel: 'global_tv', court: DEVICE_ROLE, payload: payloadScore });
                }
            }

            database.ref().update(updates).catch(e => console.warn("RTDB background sync tertunda.", e));
        }

        // D. RESET UI LOKAL
        isSaving = false;
        document.body.style.cursor = 'default';
        resetTimer();

        if (ACTIVE_PLAYLIST.isActive) {
            autoNextPlaylistMatch();
        } else {
            let selectEl = document.getElementById('select-peserta');
            if (selectEl && selectEl.selectedIndex < selectEl.options.length - 1) {
                selectEl.selectedIndex++;
                updateScoringButtonsUI();
            }
        }

    } catch (err) {
        isSaving = false;
        document.body.style.cursor = 'default';
        alert("Gagal Simpan: " + err);
    }
}

function updateTimerUI() { document.getElementById('timer-display').innerText = `${Math.floor(UI.timerSeconds / 60).toString().padStart(2, '0')}:${(UI.timerSeconds % 60).toString().padStart(2, '0')}`; pushRandoriToTV(); }

function calculateRandoriFinalists(catName) {
    let catMatches = STATE.matches.filter(m => m.kategori === catName);
    let pools = [...new Set(catMatches.map(m => m.pool))];
    let results = [];

    pools.forEach(poolName => {
        let poolMatches = catMatches.filter(m => m.pool === poolName);
        let grandFinals = poolMatches.filter(m => m.nextW === 'WINNER').sort((a, b) => b.id - a.id);

        if (grandFinals.length === 0 || grandFinals[0].status !== 'done') return;

        let gf = grandFinals[0];
        let juara1 = STATE.participants.find(p => p.id === gf.winnerId);
        let juara2 = STATE.participants.find(p => p.id === gf.loserId);

        let perungguArr = [];
        let mode = (STATE.settings && STATE.settings.tournamentMode) ? STATE.settings.tournamentMode : 'double';
        let finalMode = (STATE.settings && STATE.settings.finalRandoriMode) ? STATE.settings.finalRandoriMode : 'single';

        let isFinalCategory = catName.toUpperCase().includes('FINAL');
        let activeMode = isFinalCategory ? finalMode : mode;

        if (activeMode === 'single') {
            // MODE UMUM (SINGLE): Ambil 2 orang yang kalah di Semi-Final (Juara 3 Bersama)
            let sfs = poolMatches.filter(m => m.nextW === gf.matchNum && (m.status === 'done' || m.status === 'auto-win'));
            sfs.forEach(sf => {
                if (sf.loserId && sf.loserId !== -1) {
                    let p3 = STATE.participants.find(p => p.id === sf.loserId);
                    if (p3) perungguArr.push({ nama: p3.nama, kontingen: p3.kontingen });
                }
            });
        } else {
            // --- FIX BUG DOUBLE ELIMINATION ---
            // Hanya ambil 1 orang yang gugur di partai "FINAL BAWAH" (Juara 3 Mutlak)
            // Yang gugur sebelumnya (LB Semi-Final) dibiarkan menjadi Peringkat 4.
            let finalBawah = poolMatches.find(m => m.babak.toUpperCase() === "FINAL BAWAH" || m.babak.toUpperCase() === "LB FINAL");
            let juara3Mutlak = (finalBawah && finalBawah.status === 'done') ? STATE.participants.find(p => p.id === finalBawah.loserId) : null;

            if (juara3Mutlak) perungguArr.push({ nama: juara3Mutlak.nama, kontingen: juara3Mutlak.kontingen });
        }

        results.push({
            pool: poolName,
            emas: juara1 ? juara1.nama : null,
            emasKontingen: juara1 ? juara1.kontingen : null,
            perak: juara2 ? juara2.nama : null,
            perakKontingen: juara2 ? juara2.kontingen : null,
            perunggu: perungguArr
        });
    });

    return results.length > 0 ? results : null;
}

function cancelFinalist() {
    const filter = document.getElementById('rank-filter-kategori').value;
    if (!filter) return;
    if (!confirm("⚠️ Batalkan status finalis untuk kategori ini?\nData akan dikembalikan ke Pool awal.")) return;
    let catParts = STATE.participants.filter(p => p.kategori === filter);
    let changed = false;
    catParts.forEach(p => {
        if (p.isFinalist) {
            p.isFinalist = false; p.urutFinal = 0;
            if (p.pool === 'FINAL') {
                let takenA = catParts.some(x => x.pool === 'A' && x.urut === p.urut && x.id !== p.id);
                let takenB = catParts.some(x => x.pool === 'B' && x.urut === p.urut && x.id !== p.id);
                if (takenA && !takenB) p.pool = 'B'; else if (takenB && !takenA) p.pool = 'A'; else p.pool = 'A';
            }
            changed = true;
        }
    });
    if (changed) { saveToLocalStorage(); alert("Status Finalis dibatalkan!"); renderRanking(); checkExistingDrawing(); filterPesertaScoring(); }
}

function promoteToFinal() {
    const filter = document.getElementById('rank-filter-kategori').value;
    if (!filter) return alert("Pilih kategori spesifik terlebih dahulu!");
    const catObj = STATE.categories.find(c => c.name === filter);
    if (catObj && catObj.discipline === 'randori') return alert("Tindakan ini hanya untuk nomor Embu.");

    let list = STATE.participants.filter(p => p.kategori === filter && p.pool !== '-' && p.pool !== 'SINGLE' && p.pool !== 'FINAL');
    if (list.length === 0) return alert("Kategori ini tidak memiliki sistem Pool penyisihan.");
    if (list.some(p => p.isFinalist)) return alert("Finalis sudah ditetapkan!");

    let numFinalists = parseInt(prompt("Masukkan JUMLAH finalis DARI MASING-MASING POOL (misal: 3):", "3"));
    if (!numFinalists || isNaN(numFinalists) || numFinalists <= 0) return;

    // Tarik atlet dari berapapun Pool yang tercipta (A, B, C, dst)
    let combined = [];
    let uniquePools = [...new Set(list.map(p => p.pool))].sort();

    uniquePools.forEach(poolName => {
        let poolParts = list.filter(p => p.pool === poolName && p.scores.b1.final > 0).sort((a, b) => b.scores.b1.final - a.scores.b1.final || b.scores.b1.tech - a.scores.b1.tech);
        combined = combined.concat(poolParts.slice(0, numFinalists));
    });

    if (combined.length === 0) return alert("Tidak ada data nilai.");
    if (confirm(`Tetapkan ${combined.length} peserta ini sebagai Finalis?`)) {
        combined.forEach(w => { let p = STATE.participants.find(x => x.id === w.id); if (p) { p.isFinalist = true; p.urutFinal = 0; } });
        saveToLocalStorage(); alert("Finalis ditetapkan!"); renderRanking(); checkExistingDrawing(); filterPesertaScoring();
    }
}

// =========================================================
// MAGIC BUTTON: AUTO GENERATE FINAL RANDORI DARI POOL
// =========================================================
function autoGenerateRandoriFinal(catName) {
    const poolResults = calculateRandoriFinalists(catName);
    if (!poolResults) return alert("Belum ada hasil pertandingan yang selesai.");

    let poolA = poolResults.find(r => r.pool === 'A');
    let poolB = poolResults.find(r => r.pool === 'B');

    // Validasi Cerdas: Tolak jika belum ada juara yang sah
    if (!poolA || !poolA.emas || !poolA.perak || !poolB || !poolB.emas || !poolB.perak) {
        return alert("❌ PENOLAKAN SISTEM:\nTurnamen Pool A dan Pool B belum selesai sepenuhnya. Pastikan masing-masing Pool sudah mendapatkan Juara 1 dan 2.");
    }

    const finalCatName = "FINAL " + catName;

    if (confirm(`🌟 MAGIC BUTTON AKTIF!\n\nSistem akan otomatis:\n1. Membuat kategori baru bernama "${finalCatName}"\n2. Menyalin Juara 1 & 2 dari Pool A dan B.\n3. Menyiapkan susunan Crossover (Silang).\n\nLanjutkan?`)) {

        // 1. Buat Kategori "FINAL ..." jika belum ada
        if (!STATE.categories.some(c => c.name === finalCatName)) {
            const originalCat = STATE.categories.find(c => c.name === catName);
            STATE.categories.push({
                id: Date.now(),
                name: finalCatName,
                type: originalCat ? originalCat.type : 1,
                discipline: 'randori'
            });
        }

        // 2. Ambil data atlet asli dari database
        const p1A = STATE.participants.find(p => p.nama === poolA.emas && p.kategori === catName);
        const p2A = STATE.participants.find(p => p.nama === poolA.perak && p.kategori === catName);
        const p1B = STATE.participants.find(p => p.nama === poolB.emas && p.kategori === catName);
        const p2B = STATE.participants.find(p => p.nama === poolB.perak && p.kategori === catName);

        // 3. Bersihkan peserta lama di kategori Final (agar tidak dobel jika tombol diklik 2x)
        STATE.participants = STATE.participants.filter(p => p.kategori !== finalCatName);

        // 4. INJEKSI ATLET (Urutan SANGAT PENTING: 1A, 2A, 1B, 2B untuk menjamin bagan Crossover akurat)
        let timeOffset = 0;
        [p1A, p2A, p1B, p2B].forEach(pOriginal => {
            if (pOriginal) {
                // Buat kloningan data atlet
                STATE.participants.push({
                    id: Date.now() + timeOffset++,
                    nama: pOriginal.nama,
                    kontingen: pOriginal.kontingen,
                    kategori: finalCatName,
                    urut: 0, pool: '-', isFinalist: false, urutFinal: 0, losses: 0,
                    scores: { b1: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 }, b2: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 } },
                    finalScore: 0, techScore: 0
                });
            }
        });

        // 5. Simpan dan Lemparkan Panitia ke Tab Drawing!
        let updates = {};
        updates['turnamen_data/categories'] = STATE.categories;
        updates['turnamen_data/participants'] = STATE.participants;

        database.ref().update(updates).then(() => {
            alert("✅ Kategori FINAL berhasil disiapkan!\n\nAnda akan otomatis diarahkan ke Tab Drawing. Silakan klik tombol merah 'GENERATE BAGAN BARU' untuk memunculkan bagan silang (Crossover).");

            updateAllDropdowns(); // Perbarui seluruh list dropdown

            // Auto-pilih kategori final dan pindah tab
            let drawSelect = document.getElementById('draw-select-kategori');
            if (drawSelect) drawSelect.value = finalCatName;
            switchTab('drawing');

        }).catch(err => alert("Gagal membuat Final: " + err));
    }
}

// INJEKSI DOM UNTUK TOMBOL UNDUH HASIL (MIKRO)
function renderRanking() {
    const filter = document.getElementById('rank-filter-kategori').value;
    const btnPromote = document.getElementById('btn-promote-final');
    const container = document.getElementById('ranking-list');

    let microRankBtn = document.getElementById('btn-micro-rank-export');
    if (!microRankBtn && btnPromote && btnPromote.parentElement) {
        microRankBtn = document.createElement('button');
        microRankBtn.id = 'btn-micro-rank-export';
        microRankBtn.className = 'whitespace-nowrap bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors text-sm flex items-center justify-center gap-2';
        microRankBtn.innerHTML = '<i class="fas fa-file-csv"></i> UNDUH HASIL RAW';

        // FIX: Arahkan khusus ke fungsi RAW
        microRankBtn.onclick = () => exportRawHasilCSV(document.getElementById('rank-filter-kategori').value);
        btnPromote.parentElement.appendChild(microRankBtn);
    }

    if (!filter) {
        btnPromote.classList.add('hidden');
        if (microRankBtn) microRankBtn.classList.add('hidden');
        return container.innerHTML = `<div class="p-10 text-center text-slate-500 border border-dashed border-slate-700 rounded-xl"><i class="fas fa-filter text-3xl mb-3 text-slate-600 block"></i>Pilih kategori pertandingan di atas untuk melihat hasil klasemen.</div>`;
    }

    if (microRankBtn) microRankBtn.classList.remove('hidden');

    let catObj = STATE.categories.find(c => c.name === filter);
    let catList = STATE.participants.filter(p => p.kategori === filter);
    const hasPools = catList.some(p => p.pool !== '-' && p.pool !== 'SINGLE' && p.pool !== 'FINAL');
    const hasFinal = catList.some(p => p.isFinalist);

    if (catObj && catObj.discipline === 'embu' && hasPools) {
        btnPromote.classList.remove('hidden');
        if (!hasFinal) {
            btnPromote.innerHTML = '<i class="fas fa-arrow-up mr-2"></i>TETAPKAN FINALIS';
            btnPromote.className = "whitespace-nowrap bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors text-sm";
            btnPromote.onclick = promoteToFinal;
        } else {
            btnPromote.innerHTML = '<i class="fas fa-undo mr-2"></i>BATALKAN FINALIS';
            btnPromote.className = "whitespace-nowrap bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors text-sm";
            btnPromote.onclick = cancelFinalist;
        }
    } else if (catObj && catObj.discipline === 'randori') {
        const poolResults = calculateRandoriFinalists(filter);
        const hasPoolA = poolResults && poolResults.some(r => r.pool === 'A');
        const hasPoolB = poolResults && poolResults.some(r => r.pool === 'B');
        const isAlreadyFinal = filter.toUpperCase().includes('FINAL');

        // FIX MAGIC BUTTON: Munculkan tombol generate jika ada Pool A & B dan belum masuk kategori Final
        if (hasPoolA && hasPoolB && !isAlreadyFinal) {
            btnPromote.classList.remove('hidden');
            btnPromote.innerHTML = '<i class="fas fa-magic mr-2"></i>GENERATE PARTAI FINAL';
            btnPromote.className = "whitespace-nowrap bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors text-sm animate-pulse";
            btnPromote.onclick = () => autoGenerateRandoriFinal(filter);
        } else {
            btnPromote.classList.add('hidden');
        }
    } else {
        btnPromote.classList.add('hidden');
    }

    let hasData = catList.some(p => p.scores.b1.final > 0 || p.losses > 0 || (catObj.discipline === 'randori' && calculateRandoriFinalists(filter)));

    if (!hasData) {
        if (catObj.discipline === 'randori') { return container.innerHTML = `<div class="p-10 text-center text-slate-500 border border-dashed border-slate-700 rounded-xl">Turnamen Randori belum selesai / belum ada juara.</div>`; }
        else { return container.innerHTML = `<div class="p-10 text-center text-slate-500 border border-dashed border-slate-700 rounded-xl">Belum ada data nilai di kategori ini.</div>`; }
    }

    let htmlOutput = `<h3 class="text-xl font-bold text-yellow-400 mt-4 mb-4 border-b-2 border-slate-700 pb-3 flex items-center gap-3"><span class="${catObj.discipline === 'randori' ? 'bg-red-700' : 'bg-blue-600'} text-[10px] px-2 py-1 rounded font-black">${catObj.discipline.toUpperCase()}</span>${catObj.name}</h3>`;

    if (catObj.discipline === 'festival') {
        btnPromote.classList.add('hidden');
        let unikPools = [...new Set(catList.filter(p => p.urut > 0).map(p => p.pool))].sort();
        if (unikPools.length === 0) return container.innerHTML = `<div class="p-10 text-center text-slate-500 border border-dashed border-slate-700 rounded-xl">Belum ada data di kategori Festival ini.</div>`;

        unikPools.forEach(poolKey => {
            let poolParts = catList.filter(p => p.pool === poolKey && p.scores.b1.final > 0);
            if (poolParts.length === 0) return;

            poolParts.sort((a, b) => b.scores.b1.final - a.scores.b1.final || b.scores.b1.tech - a.scores.b1.tech);
            htmlOutput += `<h4 class="text-md font-bold text-green-400 mt-6 mb-3 pl-2 border-l-4 border-green-500">KLASEMEN KELOMPOK ${poolKey}</h4>`;

            htmlOutput += poolParts.map((p, i) => {
                let medalIcon = "";
                // Peringkat 1(Emas), 2(Perak), 3&4(Perunggu)
                if (i === 0) medalIcon = '<i class="fas fa-medal text-yellow-400 text-2xl drop-shadow-[0_0_5px_rgba(234,179,8,0.5)]"></i>';
                else if (i === 1) medalIcon = '<i class="fas fa-medal text-slate-300 text-2xl drop-shadow-[0_0_5px_rgba(203,213,225,0.5)]"></i>';
                else if (i === 2 || i === 3) medalIcon = '<i class="fas fa-medal text-amber-600 text-2xl drop-shadow-[0_0_5px_rgba(217,119,6,0.5)]"></i>';
                else medalIcon = `<span class="text-2xl font-black text-slate-600">${i + 1}</span>`;

                let displayFinal = p.scores.b1.final.toFixed(2);
                return `<div class="flex flex-col md:flex-row items-start md:items-center bg-dark-card p-4 rounded-xl border border-slate-700 gap-4 mb-3 hover:bg-slate-800/50 transition-colors">
                    <div class="w-12 text-center flex-shrink-0">${medalIcon}</div>
                    <div class="flex-1 w-full">
                        <div class="font-bold text-lg text-white whitespace-normal break-words">${formatNama(p.nama, 'html')}</div>
                        <div class="text-xs text-slate-400 mt-1"><span class="bg-slate-800 px-2 py-1 rounded border border-slate-700 shadow-sm">${p.kontingen}</span></div>
                    </div>
                    <div class="flex gap-2 w-full md:w-auto mt-4 md:mt-0 pt-4 md:pt-0 border-t md:border-t-0 border-slate-700 items-center justify-end">
                        <div class="text-center md:text-right pl-3">
                            <div class="text-[10px] text-green-400 font-bold uppercase tracking-wider">Nilai Akhir</div>
                            <div class="text-2xl font-black text-white">${displayFinal}</div>
                        </div>
                    </div>
                </div>`;
            }).join('');
        });
    } else if (catObj.discipline === 'embu') {
        let dynamicPools = [...new Set(catList.filter(p => p.pool !== '-' && p.pool !== 'SINGLE' && p.pool !== 'FINAL').map(p => p.pool))].sort();
        let poolKeys = ['FINAL', 'SINGLE'].concat(dynamicPools);

        poolKeys.forEach(poolKey => {
            let poolList = [];
            if (poolKey === 'FINAL') {
                poolList = catList.filter(p => p.isFinalist && p.scores.b2.final > 0);
            } else {
                poolList = catList.filter(p => p.pool === poolKey && p.scores.b1.final > 0);
            }

            if (poolList.length === 0) return;

            let minPeserta = (STATE.settings && STATE.settings.minPesertaJuara) ? parseInt(STATE.settings.minPesertaJuara) : 1;
            let isEksibisi = (catObj.discipline === 'embu' && catList.length < minPeserta && STATE.settings && STATE.settings.eksibisiLangsungFinal === true);

            // Hitung nilai gabungan untuk Single Pool jika ada
            if (poolKey === 'SINGLE') {
                poolList.forEach(p => {
                    if (isEksibisi) {
                        p.calcFinal = p.scores.b1.final || 0;
                        p.calcTech = p.scores.b1.tech || 0;
                    } else {
                        let s1 = p.scores.b1.final || 0; let s2 = p.scores.b2.final || 0;
                        p.calcFinal = (s1 > 0 && s2 > 0) ? ((s1 + s2) / 2) : (s1 > 0 ? s1 : s2);
                        let t1 = p.scores.b1.tech || 0; let t2 = p.scores.b2.tech || 0;
                        p.calcTech = (s1 > 0 && s2 > 0) ? ((t1 + t2) / 2) : (s1 > 0 ? t1 : t2);
                    }
                });
            }

            // 🔥 SORTING HIRARKIS: Nilai Akhir -> TB1 (Wasit 1) -> TB2 (Total Teknik Sah)
            poolList.sort((a, b) => {
                let scoreA = poolKey === 'SINGLE' ? (a.calcFinal || 0) : (poolKey === 'FINAL' ? (a.scores.b2.final || 0) : (a.scores.b1.final || 0));
                let scoreB = poolKey === 'SINGLE' ? (b.calcFinal || 0) : (poolKey === 'FINAL' ? (b.scores.b2.final || 0) : (b.scores.b1.final || 0));
                if (scoreB !== scoreA) return scoreB - scoreA;

                // Cek TB1 (Wasit Utama)
                let bDataA = poolKey === 'FINAL' ? a.scores.b2 : a.scores.b1;
                let bDataB = poolKey === 'FINAL' ? b.scores.b2 : b.scores.b1;

                let tb1A = (bDataA && bDataA.techRaw) ? (bDataA.techRaw[0] || 0) : 0;
                let tb1B = (bDataB && bDataB.techRaw) ? (bDataB.techRaw[0] || 0) : 0;
                if (tb1B !== tb1A) return tb1B - tb1A;

                // Cek TB2 (Total Teknik Sah)
                let tb2A = bDataA ? (bDataA.tech || 0) : 0;
                let tb2B = bDataB ? (bDataB.tech || 0) : 0;
                return tb2B - tb2A;
            });

            // Deteksi skor kembar untuk memunculkan lencana verifikasi
            let scoreCount = {};
            poolList.forEach(p => {
                let sc = poolKey === 'SINGLE' ? p.calcFinal : (poolKey === 'FINAL' ? p.scores.b2.final : p.scores.b1.final);
                if (sc > 0) scoreCount[sc] = (scoreCount[sc] || 0) + 1;
            });

            let poolTitle = poolKey === 'SINGLE' ? (isEksibisi ? 'KLASEMEN AKHIR (EKSIBISI 1 BABAK)' : 'KLASEMEN AKHIR') : poolKey === 'FINAL' ? '<i class="fas fa-star text-yellow-400"></i> KLASEMEN FINAL' : `KLASEMEN POOL ${poolKey}`;
            htmlOutput += `<h4 class="text-md font-bold text-blue-400 mt-6 mb-3 pl-2 border-l-4 border-blue-500">${poolTitle}</h4>`;

            htmlOutput += poolList.map((p, i) => {
                let scoreB1 = p.scores.b1.final || 0;
                let scoreB2 = p.scores.b2.final || 0;
                let finalScore = (poolKey === 'SINGLE') ? p.calcFinal : (poolKey === 'FINAL' ? scoreB2 : scoreB1);

                let isWaiting = finalScore === 0;
                let medal = isWaiting ? `<span class="text-xl font-bold text-slate-600">-</span>` : i === 0 ? '<i class="fas fa-medal text-yellow-400 text-2xl"></i>' : i === 1 ? '<i class="fas fa-medal text-slate-300 text-2xl"></i>' : i === 2 ? '<i class="fas fa-medal text-amber-600 text-2xl"></i>' : `<span class="text-2xl font-black text-slate-600">${i + 1}</span>`;

                let displayB1 = scoreB1 > 0 ? scoreB1.toFixed(1) : '-';
                let displayB2 = scoreB2 > 0 ? scoreB2.toFixed(1) : '-';
                let displayFinal = isWaiting ? "000.0" : finalScore.toFixed(2);
                let displayColor = isWaiting ? "text-slate-500" : "text-white";

                // 🔥 Lencana Peringatan jika nilai sama tapi nilai teknik belum diinput
                let bData = poolKey === 'FINAL' ? p.scores.b2 : p.scores.b1;
                let tb1Val = (bData && bData.techRaw) ? (bData.techRaw[0] || 0) : 0;
                let isTiedWithoutTech = (scoreCount[finalScore] > 1 && tb1Val === 0);

                let cautionBadge = isTiedWithoutTech
                    ? `<span class="bg-amber-950/70 text-amber-400 border border-amber-500/70 px-2 py-0.5 rounded text-[10px] font-black ml-2 inline-flex items-center gap-1 shadow-sm animate-pulse"><i class="fas fa-exclamation-triangle"></i> BUTUH VERIFIKASI TEKNIK</span>`
                    : '';

                let extraScoresHTML = '';
                if (poolKey === 'SINGLE' && scoreB1 > 0 && !isEksibisi) {
                    extraScoresHTML = `
                   <div class="text-center md:text-right px-3 border-r border-slate-700">
                        <div class="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Babak 1</div>
                        <div class="text-lg font-bold text-slate-300">${displayB1}</div>
                   </div>
                   <div class="text-center md:text-right px-3 border-r border-slate-700">
                        <div class="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Babak 2</div>
                        <div class="text-lg font-bold text-slate-300">${displayB2}</div>
                   </div>`;
                }

                return `<div class="flex flex-col md:flex-row items-start md:items-center bg-dark-card p-4 rounded-xl border border-slate-700 gap-4 mb-3 hover:bg-slate-800/50 transition-colors">
                    <div class="w-12 text-center flex-shrink-0">${medal}</div>
                    <div class="flex-1 w-full">
                        <div class="font-bold text-lg ${displayColor} whitespace-normal break-words">
                            ${formatNama(p.nama, 'html')} 
                            ${poolKey !== 'FINAL' && p.isFinalist ? '<span class="text-[10px] bg-yellow-500 text-black px-2 py-0.5 rounded ml-2 shadow-sm font-black tracking-wide">LULUS FINAL</span>' : ''}
                            ${cautionBadge}
                        </div>
                        <div class="text-xs text-slate-400 mt-1"><span class="bg-slate-800 px-2 py-1 rounded border border-slate-700 shadow-sm">${p.kontingen}</span></div>
                    </div>
                    <div class="flex gap-2 w-full md:w-auto mt-4 md:mt-0 pt-4 md:pt-0 border-t md:border-t-0 border-slate-700 items-center justify-end">
                        ${extraScoresHTML}
                        <div class="text-center md:text-right pl-3">
                            <div class="text-[10px] ${isWaiting ? 'text-slate-500' : 'text-green-400'} font-bold uppercase tracking-wider">${isWaiting ? 'Menunggu' : 'Nilai Akhir'}</div>
                            <div class="text-2xl font-black ${displayColor}">${displayFinal}</div>
                        </div>
                    </div>
                </div>`;
            }).join('');
        });
    } else {
        const poolResults = calculateRandoriFinalists(catObj.name);
        if (!poolResults) {
            htmlOutput += `<div class="p-6 text-center text-slate-600 bg-slate-900/50 rounded-xl border border-slate-800 text-sm italic">Turnamen di kategori ini masih berlangsung.</div>`;
        } else {
            poolResults.forEach(res => {
                let isFinalCat = catObj.name.toUpperCase().includes('FINAL');
                let isSinglePool = res.pool === '-';
                let title = isFinalCat || isSinglePool ? "PEMENANG MEDALI" : `JUARA POOL ${res.pool}`;
                let label1 = isFinalCat || isSinglePool ? "Juara 1 (Emas)" : `Juara 1 Pool ${res.pool}`;
                let label2 = isFinalCat || isSinglePool ? "Juara 2 (Perak)" : `Runner-Up Pool ${res.pool}`;

                // --- FIX TEKS LABEL DINAMIS ---
                // Jika array perunggu isi 2 orang = Bersama. Jika 1 orang = Mutlak.
                let teksJuara3 = res.perunggu.length > 1 ? "Juara 3 Bersama (Perunggu)" : "Juara 3 (Perunggu)";
                let label3 = isFinalCat || isSinglePool ? teksJuara3 : `${res.perunggu.length > 1 ? "Juara 3 Bersama" : "Juara 3"} Pool ${res.pool}`;

                htmlOutput += `<h4 class="text-md font-bold text-red-400 mt-6 mb-3 pl-2 border-l-4 border-red-500">${title}</h4>`;
                if (res.emas) htmlOutput += `<div class="flex items-center bg-dark-card p-4 rounded-xl border border-yellow-600 gap-4 mb-3 bg-yellow-600/10"><div class="w-12 text-center flex-shrink-0"><i class="fas fa-medal text-yellow-400 text-3xl drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]"></i></div><div class="flex-1"><div class="font-bold text-lg text-white whitespace-normal break-words">${formatNama(res.emas, 'html')}</div><div class="text-xs text-slate-400 mt-1 uppercase font-bold text-yellow-500 tracking-wider">${res.emasKontingen} &bull; ${label1}</div></div></div>`;
                if (res.perak) htmlOutput += `<div class="flex items-center bg-dark-card p-4 rounded-xl border border-slate-600 gap-4 mb-3 bg-slate-500/10"><div class="w-12 text-center flex-shrink-0"><i class="fas fa-medal text-slate-300 text-3xl drop-shadow-[0_0_10px_rgba(203,213,225,0.5)]"></i></div><div class="flex-1"><div class="font-bold text-lg text-white whitespace-normal break-words">${formatNama(res.perak, 'html')}</div><div class="text-xs text-slate-400 mt-1 uppercase font-bold text-slate-300 tracking-wider">${res.perakKontingen} &bull; ${label2}</div></div></div>`;
                res.perunggu.forEach(p => { htmlOutput += `<div class="flex items-center bg-dark-card p-4 rounded-xl border border-amber-700 gap-4 mb-3 bg-amber-800/10"><div class="w-12 text-center flex-shrink-0"><i class="fas fa-medal text-amber-600 text-3xl drop-shadow-[0_0_10px_rgba(217,119,6,0.5)]"></i></div><div class="flex-1"><div class="font-bold text-lg text-white whitespace-normal break-words">${formatNama(p.nama, 'html')}</div><div class="text-xs text-slate-400 mt-1 uppercase font-bold text-amber-600 tracking-wider">${p.kontingen} &bull; ${label3}</div></div></div>`; });
            });
        }
    }
    container.innerHTML = htmlOutput;
}

function renderJuaraUmum() {
    let tally = {};
    const minPeserta = (STATE.settings && STATE.settings.minPesertaJuara) ? parseInt(STATE.settings.minPesertaJuara) : 1;

    STATE.categories.forEach(cat => {
        // PROTEKSI 1: FESTIVAL MUTLAK TIDAK MASUK JUARA UMUM
        if (cat.discipline === 'festival') return;

        let catParts = STATE.participants.filter(p => p.kategori === cat.name);
        const minPeserta = (STATE.settings && STATE.settings.minPesertaJuara) ? parseInt(STATE.settings.minPesertaJuara) : 1;

        // PROTEKSI 2: KELAS EKSIBISI TIDAK MASUK JUARA UMUM
        let isEksibisi = (cat.discipline === 'embu' && catParts.length < minPeserta && STATE.settings && STATE.settings.eksibisiLangsungFinal === true);
        if (isEksibisi) return;

        // ... (lanjutkan kode logika Juara Umum di bawahnya yang sudah ada)
        const isFinalCategory = cat.name.toUpperCase().includes('FINAL');

        let baseName = cat.name.replace(/FINAL/ig, '').trim().toLowerCase();
        let relatedParticipants = STATE.participants.filter(p => p.kategori.replace(/FINAL/ig, '').trim().toLowerCase() === baseName);
        let uniqueAthletes = new Set(relatedParticipants.map(p => p.nama.toLowerCase().trim()));
        let trueParticipantCount = uniqueAthletes.size;

        if (trueParticipantCount < minPeserta) return;

        if (cat.discipline === 'embu') {
            // FIX JUARA UMUM EMBU SINGLE POOL
            let hasFinalists = catParts.some(p => p.isFinalist);
            let targetParts = [];

            if (hasFinalists) {
                targetParts = catParts.filter(p => p.isFinalist && p.scores.b2.final > 0);
                targetParts.forEach(p => { p.calcFinal = p.scores.b2.final; p.calcTech = p.scores.b2.tech; });
            } else if (catParts.some(p => p.pool === 'SINGLE' || p.pool === '-')) {
                targetParts = catParts.filter(p => (p.pool === 'SINGLE' || p.pool === '-') && p.urut > 0);
                targetParts.forEach(p => {
                    let s1 = p.scores.b1.final || 0; let s2 = p.scores.b2.final || 0;
                    p.calcFinal = (s1 > 0 && s2 > 0) ? ((s1 + s2) / 2) : (s1 > 0 ? s1 : s2);
                    let t1 = p.scores.b1.tech || 0; let t2 = p.scores.b2.tech || 0;
                    p.calcTech = (s1 > 0 && s2 > 0) ? ((t1 + t2) / 2) : (s1 > 0 ? t1 : t2);
                });
            }

            let wins = targetParts.filter(p => p.calcFinal > 0).sort((a, b) => b.calcFinal - a.calcFinal || b.calcTech - a.calcTech);
            if (wins[0] && wins[0].kontingen) { tally[wins[0].kontingen] = tally[wins[0].kontingen] || { g: 0, s: 0, b: 0 }; tally[wins[0].kontingen].g++; }
            if (wins[1] && wins[1].kontingen) { tally[wins[1].kontingen] = tally[wins[1].kontingen] || { g: 0, s: 0, b: 0 }; tally[wins[1].kontingen].s++; }
            if (wins[2] && wins[2].kontingen) { tally[wins[2].kontingen] = tally[wins[2].kontingen] || { g: 0, s: 0, b: 0 }; tally[wins[2].kontingen].b++; }
        } else {
            const hasPools = catParts.some(p => p.pool === 'A' || p.pool === 'B');
            if (hasPools && !isFinalCategory) return;

            const poolResults = calculateRandoriFinalists(cat.name);
            if (!poolResults) return;

            poolResults.forEach(res => {
                if (res.emasKontingen) { tally[res.emasKontingen] = tally[res.emasKontingen] || { g: 0, s: 0, b: 0 }; tally[res.emasKontingen].g++; }
                if (res.perakKontingen) { tally[res.perakKontingen] = tally[res.perakKontingen] || { g: 0, s: 0, b: 0 }; tally[res.perakKontingen].s++; }
                res.perunggu.forEach(p => {
                    if (p.kontingen) { tally[p.kontingen] = tally[p.kontingen] || { g: 0, s: 0, b: 0 }; tally[p.kontingen].b++; }
                });
            });
        }
    });

    let leaderboard = Object.keys(tally).map(kontingen => ({ nama: kontingen, emas: tally[kontingen].g, perak: tally[kontingen].s, perunggu: tally[kontingen].b, total: tally[kontingen].g + tally[kontingen].s + tally[kontingen].b }));
    leaderboard.sort((a, b) => b.emas - a.emas || b.perak - a.perak || b.perunggu - a.perunggu);

    const tbody = document.getElementById('table-juara-body');
    if (leaderboard.length === 0) return tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-500 border-b border-slate-700">Belum ada data medali disumbangkan.</td></tr>`;
    tbody.innerHTML = leaderboard.map((k, i) => `<tr class="hover:bg-slate-800/50 transition-colors"><td class="p-4 text-center font-bold text-slate-500 border-b border-slate-800">${i + 1}</td><td class="p-4 font-bold text-white border-b border-slate-800 text-lg whitespace-normal break-words">${k.nama}</td><td class="p-4 text-center font-black text-yellow-500 border-b border-slate-800 bg-yellow-500/10">${k.emas}</td><td class="p-4 text-center font-black text-slate-300 border-b border-slate-800 bg-slate-400/10">${k.perak}</td><td class="p-4 text-center font-black text-amber-600 border-b border-slate-800 bg-amber-600/10">${k.perunggu}</td><td class="p-4 text-center font-black text-blue-400 border-b border-slate-800">${k.total}</td></tr>`).join('');
}

// ---------------------------------------------------------
// CSV EXPORT LOGIC (MULTIFUNCTION: MICRO & MACRO)
// ---------------------------------------------------------
function downloadCSV(filename, rows) {
    // 1. \uFEFF adalah BOM (Byte Order Mark) agar Excel membaca teks dengan rapi
    // 2. .join(";") mengganti pemisah dari koma (,) menjadi titik koma (;) khusus Excel Indonesia
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF" + rows.map(e => e.map(cell => `"${cell}"`).join(";")).join("\n");

    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = filename;
    link.click();
}

async function exportDrawingExcel(filterCatName = null) {
    if (typeof ExcelJS === 'undefined') {
        return alert("Library ExcelJS belum termuat. Pastikan koneksi internet aktif untuk memuat library pembuat Excel.");
    }

    try {
        document.body.style.cursor = 'wait';

        // 1. Inisialisasi Kertas Kerja Excel
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Hasil Drawing", {
            pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });

        // 2. Set Ukuran Kolom
        sheet.getColumn(1).width = 10; // Urutan
        sheet.getColumn(2).width = 15; // POOL
        sheet.getColumn(3).width = 30; // Kontingen
        sheet.getColumn(4).width = 45; // Nama Atlet

        // 3. Deklarasi Styling Visual
        const borderAll = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        const titleStyle = { font: { name: 'Arial', size: 14, bold: true }, alignment: { horizontal: 'center' } };
        const subtitleStyle = { font: { name: 'Arial', size: 10, italic: true }, alignment: { horizontal: 'center' } };

        const headerCatStyle = {
            font: { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }, // Biru Gelap
            alignment: { horizontal: 'left', vertical: 'middle' }
        };
        const tableHeaderStyle = {
            font: { name: 'Arial', size: 10, bold: true },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }, // Abu-abu
            alignment: { horizontal: 'center', vertical: 'middle' },
            border: borderAll
        };

        // 4. Cetak Kop Judul Utama
        sheet.mergeCells('A1:D1');
        sheet.getCell('A1').value = "HASIL DRAWING DAN JADWAL TANDING - MASS KEMPO";
        sheet.getCell('A1').style = titleStyle;

        sheet.mergeCells('A2:D2');
        sheet.getCell('A2').value = `Dicetak pada: ${new Date().toLocaleString('id-ID')}`;
        sheet.getCell('A2').style = subtitleStyle;

        let currentRow = 4;
        let dataPrinted = false; // Pelacak jika semua kosong

        // 5. Filter & Urutkan Kategori (FESTIVAL DI ATAS, disusul EMBU. Randori diabaikan)
        let categoriesToExport = filterCatName ? STATE.categories.filter(c => c.name === filterCatName) : STATE.categories;
        let drawCats = categoriesToExport.filter(c => c.discipline === 'embu' || c.discipline === 'festival');

        drawCats.sort((a, b) => {
            if (a.discipline === 'festival' && b.discipline !== 'festival') return -1;
            if (a.discipline !== 'festival' && b.discipline === 'festival') return 1;
            return 0;
        });

        if (drawCats.length === 0) {
            document.body.style.cursor = 'default';
            return alert("Tidak ada data kategori Embu atau Festival untuk diekspor.");
        }

        // 6. MESIN PENCETAK BLOK TABEL
        const printTableBlock = (title, partsList, urutProp) => {
            if (partsList.length === 0) return; // SKIP OTOMATIS JIKA KOSONG (Belum Drawing)
            dataPrinted = true;

            // Cetak Judul Baris (Misal: EMBU BERPASANGAN (BABAK 1))
            sheet.mergeCells(`A${currentRow}:D${currentRow}`);
            let catCell = sheet.getCell(`A${currentRow}`);
            catCell.value = title.toUpperCase();
            catCell.style = headerCatStyle;
            currentRow++;

            // Cetak Header Tabel
            ['Urutan', 'POOL', 'Kontingen', 'Nama Atlet'].forEach((text, i) => {
                let cell = sheet.getCell(currentRow, i + 1);
                cell.value = text; cell.style = tableHeaderStyle;
            });
            currentRow++;

            // Cetak Baris Atlet
            partsList.forEach(p => {
                // Kolom 1: Urutan (Dinamis: urut, urutFinal, atau urutB2)
                sheet.getCell(currentRow, 1).value = p[urutProp];

                // Kolom 2: POOL (Paksa 'single' jika tidak ada pool)
                let poolVal = (p.pool === '-' || p.pool === 'SINGLE') ? 'SINGLE' : p.pool;
                sheet.getCell(currentRow, 2).value = poolVal;

                // Kolom 3: Kontingen
                sheet.getCell(currentRow, 3).value = p.kontingen;

                // Kolom 4: Nama Atlet (Wrap Text, dipisah \n tiap ada koma/&/+)
                let names = String(p.nama).split(/[,+&]/).map(n => n.trim()).filter(n => n).join('\n');
                sheet.getCell(currentRow, 4).value = names;

                // Terapkan Garis & Wrap Text
                [1, 2, 3, 4].forEach(colIdx => {
                    let c = sheet.getCell(currentRow, colIdx);
                    c.border = borderAll;
                    c.alignment = {
                        vertical: 'middle',
                        horizontal: (colIdx === 3 || colIdx === 4) ? 'left' : 'center',
                        wrapText: colIdx === 4 // Fitur enter otomatis untuk nama beregu
                    };
                });
                currentRow++;
            });
            currentRow += 2; // Spasi sebelum blok tabel berikutnya
        };

        // 7. PROSES PENYORTIRAN KELOMPOK/POOL
        drawCats.forEach(cat => {
            let catParts = STATE.participants.filter(p => p.kategori === cat.name && p.urut > 0);
            if (catParts.length === 0) return; // Skip kategori ini jika sama sekali belum diundi

            if (cat.discipline === 'festival') {
                // FESTIVAL: Bagi berdasarkan Kelompok
                let unikPools = [...new Set(catParts.map(p => p.pool))].sort();
                unikPools.forEach(poolName => {
                    let poolParts = catParts.filter(p => p.pool === poolName).sort((a, b) => a.urut - b.urut);
                    printTableBlock(`${cat.discipline} ${cat.name} (KELOMPOK ${poolName})`, poolParts, 'urut');
                });
            } else if (cat.discipline === 'embu') {
                // EMBU: Cek apakah ada sistem Pool / Final
                let hasFinalists = catParts.some(p => p.isFinalist && p.urutFinal > 0);
                let isMultiPool = catParts.some(p => p.pool !== '-' && p.pool !== 'SINGLE');

                if (isMultiPool) {
                    let unikPools = [...new Set(catParts.map(p => p.pool))].sort();
                    unikPools.forEach(poolName => {
                        let poolParts = catParts.filter(p => p.pool === poolName).sort((a, b) => a.urut - b.urut);
                        printTableBlock(`${cat.discipline} ${cat.name} (PENYISIHAN POOL ${poolName})`, poolParts, 'urut');
                    });

                    if (hasFinalists) {
                        let finalParts = catParts.filter(p => p.isFinalist && p.urutFinal > 0).sort((a, b) => a.urutFinal - b.urutFinal);
                        printTableBlock(`${cat.discipline} ${cat.name} (BABAK 2 / FINAL)`, finalParts, 'urutFinal');
                    }
                } else {
                    // Jalur Single Pool
                    let b1Parts = [...catParts].sort((a, b) => a.urut - b.urut);
                    printTableBlock(`${cat.discipline} ${cat.name} (BABAK 1)`, b1Parts, 'urut');

                    let b2Parts = catParts.filter(p => p.urutB2 > 0).sort((a, b) => a.urutB2 - b.urutB2);
                    if (b2Parts.length > 0) {
                        printTableBlock(`${cat.discipline} ${cat.name} (BABAK 2)`, b2Parts, 'urutB2');
                    }
                }
            }
        });

        // 8. Peringatan jika semua kategori kosong
        if (!dataPrinted) {
            document.body.style.cursor = 'default';
            return alert("Belum ada satupun kategori Embu / Festival yang sudah dilakukan undian (Drawing).");
        }

        // 9. Kompilasi dan Unduh File Excel
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");

        let prefix = filterCatName ? `Hasil_Drawing_${filterCatName.replace(/[^a-zA-Z0-9]/g, '_')}` : `Hasil_Drawing_MASS`;
        a.download = `${prefix}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        a.href = url;

        document.body.appendChild(a);
        a.click();

        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        document.body.style.cursor = 'default';

    } catch (err) {
        document.body.style.cursor = 'default';
        console.error(err);
        alert("Gagal mencetak Rekap Excel: " + err.message);
    }
}

// =========================================================
// MESIN EKSPOR 1: DATA RAW (Untuk Tab Ranking - Detail Nilai Juri)
// =========================================================
function exportRawHasilCSV(filterCatName = null) {
    let categoriesToExport = filterCatName ? STATE.categories.filter(c => c.name === filterCatName) : STATE.categories;
    let rows = [];

    rows.push(["DATA MENTAH (RAW) HASIL PERTANDINGAN - MASS KEMPO"]);
    rows.push(["Dicetak pada:", new Date().toLocaleString('id-ID')]);
    rows.push([]);

    categoriesToExport.forEach(cat => {
        rows.push(["==============================================================="]);
        rows.push(["KATEGORI:", cat.name.toUpperCase()]);
        rows.push(["DISIPLIN:", cat.discipline.toUpperCase()]);
        rows.push(["==============================================================="]);

        if (cat.discipline === 'embu') {
            let catParts = STATE.participants.filter(p => p.kategori === cat.name);

            // TABEL B1
            rows.push([]);
            rows.push(["[ HASIL BABAK 1 / PENYISIHAN ]"]);
            rows.push(["Peringkat", "Pool", "Nama Atlet", "Kontingen", "Wasit 1", "Wasit 2", "Wasit 3", "Wasit 4", "Wasit 5", "Waktu", "Denda", "Nilai B1"]);

            let hasB1Data = false;
            ['SINGLE', 'A', 'B'].forEach(poolKey => {
                let poolParts = catParts.filter(p => p.pool === poolKey && p.urut > 0);
                if (poolParts.length === 0) return;
                poolParts.sort((a, b) => (b.scores.b1.final || 0) - (a.scores.b1.final || 0) || (b.scores.b1.tech || 0) - (a.scores.b1.tech || 0));

                poolParts.forEach((p, i) => {
                    hasB1Data = true;
                    let s = p.scores.b1;
                    let rank = (s.final > 0) ? String(i + 1) : "-";
                    let w = s.raw || [];
                    let waktuFmt = `${Math.floor((s.time || 0) / 60).toString().padStart(2, '0')}:${((s.time || 0) % 60).toString().padStart(2, '0')}`;
                    let finalScore = s.final > 0 ? s.final.toFixed(2).replace('.', ',') : "Menunggu";
                    let cetakPool = poolKey === 'SINGLE' ? '-' : poolKey;

                    // --- PECAH BARIS BERSIH ---
                    let names = String(p.nama).split(/[,+&]/).map(n => n.trim()).filter(n => n);
                    if (names.length === 0) names = ["-"];
                    names.forEach((n, idx) => {
                        if (idx === 0) rows.push([rank, cetakPool, n, p.kontingen, String(w[0] || '-').replace('.', ','), String(w[1] || '-').replace('.', ','), String(w[2] || '-').replace('.', ','), String(w[3] || '-').replace('.', ','), String(w[4] || '-').replace('.', ','), waktuFmt, s.penalty || 0, finalScore]);
                        else rows.push(["", "", n, "", "", "", "", "", "", "", "", ""]);
                    });
                });
            });
            if (!hasB1Data) rows.push(["-", "-", "Belum ada peserta diundi / dimainkan", "-", "-", "-", "-", "-", "-", "-", "-", "-"]);

            // TABEL B2
            rows.push([]);
            rows.push(["[ HASIL BABAK 2 / FINAL ]"]);
            rows.push(["Peringkat", "Pool", "Nama Atlet", "Kontingen", "Wasit 1", "Wasit 2", "Wasit 3", "Wasit 4", "Wasit 5", "Waktu", "Denda", "Nilai B2", "Nilai GABUNGAN (Akhir)"]);

            let hasFinalists = catParts.some(p => p.isFinalist);
            let b2Parts = [];
            if (hasFinalists) b2Parts = catParts.filter(p => p.isFinalist);
            else if (catParts.some(p => p.pool === 'SINGLE')) b2Parts = catParts.filter(p => p.pool === 'SINGLE' && p.urut > 0);

            if (b2Parts.length > 0) {
                b2Parts.forEach(p => {
                    let s1 = p.scores.b1.final || 0; let s2 = p.scores.b2.final || 0;
                    p.calcFinal = hasFinalists ? s2 : ((s1 > 0 && s2 > 0) ? ((s1 + s2) / 2) : (s1 > 0 ? s1 : s2));
                    let t1 = p.scores.b1.tech || 0; let t2 = p.scores.b2.tech || 0;
                    p.calcTech = hasFinalists ? t2 : ((s1 > 0 && s2 > 0) ? ((t1 + t2) / 2) : (s1 > 0 ? t1 : t2));
                });
                b2Parts.sort((a, b) => b.calcFinal - a.calcFinal || b.calcTech - a.calcTech);

                b2Parts.forEach((p, i) => {
                    let s = p.scores.b2;
                    let hasPlayedB2 = (s.final > 0);
                    let rank = hasPlayedB2 ? String(i + 1) : "-";
                    let poolLabelB2 = hasFinalists ? "FINAL" : "-";
                    let w = s.raw || [];
                    let waktuFmt = `${Math.floor((s.time || 0) / 60).toString().padStart(2, '0')}:${((s.time || 0) % 60).toString().padStart(2, '0')}`;
                    let finalB2 = hasPlayedB2 ? s.final.toFixed(2).replace('.', ',') : "Menunggu";

                    let gabungan = "Menunggu";
                    if (hasFinalists) gabungan = hasPlayedB2 ? s.final.toFixed(2).replace('.', ',') : "Menunggu";
                    else gabungan = p.calcFinal > 0 ? p.calcFinal.toFixed(2).replace('.', ',') : "Menunggu";

                    // --- PECAH BARIS BERSIH ---
                    let names = String(p.nama).split(/[,+&]/).map(n => n.trim()).filter(n => n);
                    if (names.length === 0) names = ["-"];
                    names.forEach((n, idx) => {
                        if (idx === 0) rows.push([rank, poolLabelB2, n, p.kontingen, String(w[0] || '-').replace('.', ','), String(w[1] || '-').replace('.', ','), String(w[2] || '-').replace('.', ','), String(w[3] || '-').replace('.', ','), String(w[4] || '-').replace('.', ','), waktuFmt, s.penalty || 0, finalB2, gabungan]);
                        else rows.push(["", "", n, "", "", "", "", "", "", "", "", "", ""]);
                    });
                });
            } else {
                rows.push(["-", "-", "Peserta Babak 2 / Final belum ditetapkan", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-"]);
            }
            rows.push([]); rows.push([]);

        } else if (cat.discipline === 'festival') {
            rows.push([]);
            rows.push(["[ HASIL FESTIVAL ]"]);

            let catParts = STATE.participants.filter(p => p.kategori === cat.name && p.urut > 0);
            let unikPools = [...new Set(catParts.map(p => p.pool))].sort();

            if (unikPools.length === 0) {
                rows.push(["Peringkat", "Nama Atlet", "Kontingen", "Wasit 1", "Wasit 2", "Wasit 3", "Wasit 4", "Wasit 5", "Waktu", "Denda", "Nilai Akhir"]);
                rows.push(["-", "Belum ada peserta diundi / dimainkan", "-", "-", "-", "-", "-", "-", "-", "-", "-"]);
            } else {
                let adaPemenang = false;
                unikPools.forEach(poolKey => {
                    let poolParts = catParts.filter(p => p.pool === poolKey && p.scores.b1.final > 0);
                    if (poolParts.length > 0) {
                        adaPemenang = true;

                        rows.push([`--- KELOMPOK ${poolKey} ---`, "", "", "", "", "", "", "", "", "", ""]);
                        rows.push(["Peringkat", "Nama Atlet", "Kontingen", "Wasit 1", "Wasit 2", "Wasit 3", "Wasit 4", "Wasit 5", "Waktu", "Denda", "Nilai Akhir"]);

                        poolParts.sort((a, b) => b.scores.b1.final - a.scores.b1.final || b.scores.b1.tech - a.scores.b1.tech);
                        poolParts.forEach((p, i) => {
                            let s = p.scores.b1;
                            let rank = (i === 0) ? "1" : (i === 1) ? "2" : (i === 2 || i === 3) ? "3" : String(i + 1);
                            let w = s.raw || [];
                            let waktuFmt = `${Math.floor((s.time || 0) / 60).toString().padStart(2, '0')}:${((s.time || 0) % 60).toString().padStart(2, '0')}`;
                            let finalScore = s.final.toFixed(2).replace('.', ',');

                            // --- PECAH BARIS BERSIH ---
                            let names = String(p.nama).split(/[,+&]/).map(n => n.trim()).filter(n => n);
                            if (names.length === 0) names = ["-"];
                            names.forEach((n, idx) => {
                                if (idx === 0) rows.push([rank, n, p.kontingen, String(w[0] || '-').replace('.', ','), String(w[1] || '-').replace('.', ','), String(w[2] || '-').replace('.', ','), String(w[3] || '-').replace('.', ','), String(w[4] || '-').replace('.', ','), waktuFmt, s.penalty || 0, finalScore]);
                                else rows.push(["", n, "", "", "", "", "", "", "", "", ""]);
                            });
                        });
                    }
                });
                if (!adaPemenang) {
                    rows.push(["Peringkat", "Nama Atlet", "Kontingen", "Wasit 1", "Wasit 2", "Wasit 3", "Wasit 4", "Wasit 5", "Waktu", "Denda", "Nilai Akhir"]);
                    rows.push(["-", "Belum ada nilai tersimpan", "-", "-", "-", "-", "-", "-", "-", "-", "-"]);
                }
            }
            rows.push([]); rows.push([]);

        } else {
            rows.push([]);
            rows.push(["Peringkat", "Nama Atlet", "Kontingen", "Keterangan"]);

            let catMatches = STATE.matches.filter(m => m.kategori === cat.name);
            let hasPools = catMatches.some(m => m.pool === 'A' || m.pool === 'B');
            let isFinalCat = cat.name.toUpperCase().includes('FINAL');

            if (hasPools && !isFinalCat) {
                rows.push(["-", "Sistem Pool. Hasil akhir berada di kategori FINAL.", "-", "-"]);
            } else {
                rows.push([]);
                rows.push(["Peringkat", "Nama Atlet", "Kontingen", "Keterangan"]);

                let catMatches = STATE.matches.filter(m => m.kategori === cat.name);
                let hasPools = catMatches.some(m => m.pool === 'A' || m.pool === 'B');
                let isFinalCat = cat.name.toUpperCase().includes('FINAL');

                if (hasPools && !isFinalCat) {
                    rows.push(["-", "Sistem Pool. Hasil akhir berada di kategori FINAL.", "-", "-"]);
                } else {
                    let poolResults = calculateRandoriFinalists(cat.name);
                    let foundFinalResult = false;

                    if (poolResults) {
                        poolResults.forEach(res => {
                            let isSinglePool = res.pool === '-';
                            if (isFinalCat || isSinglePool) {
                                foundFinalResult = true;
                                let label1 = isFinalCat || isSinglePool ? "Juara 1" : `Juara 1 Pool ${res.pool}`;
                                let label2 = isFinalCat || isSinglePool ? "Juara 2" : `Runner-Up Pool ${res.pool}`;

                                // --- FIX TEKS LABEL DINAMIS CSV RAW ---
                                let baseLabel3 = res.perunggu.length > 1 ? "Juara 3 Bersama" : "Juara 3";
                                let label3 = isFinalCat || isSinglePool ? baseLabel3 : `${baseLabel3} Pool ${res.pool}`;

                                if (res.emas) {
                                    String(res.emas).split(/[,+&]/).map(n => n.trim()).filter(n => n).forEach((n, idx) => {
                                        if (idx === 0) rows.push(["1", n, res.emasKontingen, label1]); else rows.push(["", n, "", ""]);
                                    });
                                }
                                if (res.perak) {
                                    String(res.perak).split(/[,+&]/).map(n => n.trim()).filter(n => n).forEach((n, idx) => {
                                        if (idx === 0) rows.push(["2", n, res.perakKontingen, label2]); else rows.push(["", n, "", ""]);
                                    });
                                }
                                res.perunggu.forEach(p => {
                                    String(p.nama).split(/[,+&]/).map(n => n.trim()).filter(n => n).forEach((n, idx) => {
                                        if (idx === 0) rows.push(["3", n, p.kontingen, label3]); else rows.push(["", n, "", ""]);
                                    });
                                });
                            }
                        });
                    } else {
                        rows.push(["-", "Belum ada juara / Turnamen masih berjalan", "-", "-"]);
                    }
                }
                rows.push([]); rows.push([]);
            }
        }
    });

    let prefix = filterCatName ? `RAW_Nilai_${filterCatName.replace(/[^a-zA-Z0-9]/g, '_')}` : `Semua_RAW_Nilai`;
    downloadCSV(`${prefix}_${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

// =========================================================
// MESIN EKSPOR 2: REKAPITULASI (SUPER EXCELJS PRINT-READY)
// =========================================================
async function exportRekapJuaraCSV(filterCatName = null) {
    if (typeof ExcelJS === 'undefined') {
        return alert("Library ExcelJS belum termuat. Pastikan koneksi internet aktif untuk memuat library pembuat Excel.");
    }

    try {
        document.body.style.cursor = 'wait';

        let categoriesToExport = filterCatName ? STATE.categories.filter(c => c.name === filterCatName) : STATE.categories;
        if (categoriesToExport.length === 0) throw new Error("Tidak ada data kategori.");

        // Inisiasi Workbook baru
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Rekap Pemenang", {
            pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });

        // 🌟 KUNCI PROPORSIONAL: Atur Lebar Kolom Di Sini 🌟
        sheet.getColumn(1).width = 12; // Peringkat
        sheet.getColumn(2).width = 45; // Nama Atlet (Sangat Lebar)
        sheet.getColumn(3).width = 30; // Kontingen (Lebar)
        sheet.getColumn(4).width = 25; // Nilai Akhir / Keterangan Randori

        // Deklarasi Gaya (*Styles*) untuk mempercantik sel
        const borderAll = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        const titleStyle = { font: { name: 'Arial', size: 14, bold: true }, alignment: { horizontal: 'center' } };
        const subtitleStyle = { font: { name: 'Arial', size: 10, italic: true }, alignment: { horizontal: 'center' } };

        const headerCatStyle = {
            font: { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }, // Biru Gelap
            alignment: { horizontal: 'left', vertical: 'middle' }
        };
        const tableHeaderStyle = {
            font: { name: 'Arial', size: 10, bold: true },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }, // Abu-abu terang
            alignment: { horizontal: 'center', vertical: 'middle' },
            border: borderAll
        };

        // 1. TULIS KOP SURAT / HEADER DOKUMEN
        sheet.mergeCells('A1:D1');
        sheet.getCell('A1').value = "REKAPITULASI PEMENANG - MASS KEMPO";
        sheet.getCell('A1').style = titleStyle;

        sheet.mergeCells('A2:D2');
        sheet.getCell('A2').value = `Dicetak pada: ${new Date().toLocaleString('id-ID')}`;
        sheet.getCell('A2').style = subtitleStyle;

        let currentRow = 4;

        // 2. LOOPING SETIAP KATEGORI
        categoriesToExport.forEach(cat => {
            // Header Baris Kategori (Warna Biru Gelap Panjang)
            sheet.mergeCells(`A${currentRow}:D${currentRow}`);
            let catCell = sheet.getCell(`A${currentRow}`);
            catCell.value = `KATEGORI: ${cat.name.toUpperCase()} (${cat.discipline.toUpperCase()})`;
            catCell.style = headerCatStyle;
            currentRow++;

            // --- JIKA DISIPLIN EMBU ---
            if (cat.discipline === 'embu') {
                ['Peringkat', 'Nama Atlet', 'Kontingen', 'Nilai Akhir'].forEach((text, i) => {
                    let cell = sheet.getCell(currentRow, i + 1);
                    cell.value = text; cell.style = tableHeaderStyle;
                });
                currentRow++;

                let catParts = STATE.participants.filter(p => p.kategori === cat.name);
                let hasFinalists = catParts.some(p => p.isFinalist);
                let targetParts = [];

                if (hasFinalists) targetParts = catParts.filter(p => p.isFinalist);
                else if (catParts.some(p => p.pool === 'SINGLE' || p.pool === '-')) targetParts = catParts.filter(p => (p.pool === 'SINGLE' || p.pool === '-') && p.urut > 0);

                if (targetParts.length > 0) {
                    targetParts.forEach(p => {
                        let s1 = p.scores.b1.final || 0; let s2 = p.scores.b2.final || 0;
                        p.calcFinal = hasFinalists ? s2 : ((s1 > 0 && s2 > 0) ? ((s1 + s2) / 2) : (s1 > 0 ? s1 : s2));
                        let t1 = p.scores.b1.tech || 0; let t2 = p.scores.b2.tech || 0;
                        p.calcTech = hasFinalists ? t2 : ((s1 > 0 && s2 > 0) ? ((t1 + t2) / 2) : (s1 > 0 ? t1 : t2));
                    });
                    targetParts.sort((a, b) => b.calcFinal - a.calcFinal || b.calcTech - a.calcTech);

                    targetParts.forEach((p, i) => {
                        let isWaiting = p.calcFinal === 0;
                        if (hasFinalists && (p.scores.b2.final || 0) === 0) isWaiting = true;

                        let rank = !isWaiting ? i + 1 : "-";
                        let nilaiAkhir = !isWaiting ? parseFloat(p.calcFinal.toFixed(2)) : "Menunggu";

                        let names = String(p.nama).split(/[,+&]/).map(n => n.trim()).filter(n => n);
                        if (names.length === 0) names = ["-"];
                        names.forEach((n, idx) => {
                            sheet.getCell(currentRow, 1).value = (idx === 0) ? rank : "";
                            sheet.getCell(currentRow, 2).value = n;
                            sheet.getCell(currentRow, 3).value = (idx === 0) ? p.kontingen : "";
                            sheet.getCell(currentRow, 4).value = (idx === 0) ? nilaiAkhir : "";

                            // Suntikkan Garis Tabel (Border)
                            [1, 2, 3, 4].forEach(colIdx => {
                                let c = sheet.getCell(currentRow, colIdx);
                                c.border = borderAll;
                                c.alignment = { vertical: 'middle', horizontal: (colIdx === 2 || colIdx === 3) ? 'left' : 'center' };
                            });
                            currentRow++;
                        });
                    });
                } else {
                    sheet.mergeCells(`A${currentRow}:D${currentRow}`);
                    let cell = sheet.getCell(`A${currentRow}`);
                    cell.value = "Peserta Final belum ditetapkan / belum diundi";
                    cell.border = borderAll; cell.alignment = { horizontal: 'center' };
                    currentRow++;
                }
            }
            // --- JIKA DISIPLIN FESTIVAL ---
            else if (cat.discipline === 'festival') {
                let catParts = STATE.participants.filter(p => p.kategori === cat.name && p.urut > 0);
                let unikPools = [...new Set(catParts.map(p => p.pool))].sort();

                if (unikPools.length === 0) {
                    sheet.mergeCells(`A${currentRow}:D${currentRow}`);
                    let cell = sheet.getCell(`A${currentRow}`);
                    cell.value = "Belum ada peserta diundi / dimainkan";
                    cell.border = borderAll; cell.alignment = { horizontal: 'center' };
                    currentRow++;
                } else {
                    let adaPemenang = false;
                    unikPools.forEach(poolKey => {
                        let poolParts = catParts.filter(p => p.pool === poolKey && p.scores.b1.final > 0);
                        if (poolParts.length === 0) return;
                        adaPemenang = true;

                        // Sub-Header Kelompok (Tanpa Garis Tebal)
                        sheet.mergeCells(`A${currentRow}:D${currentRow}`);
                        let subCell = sheet.getCell(`A${currentRow}`);
                        subCell.value = `--- KELOMPOK ${poolKey} ---`;
                        subCell.font = { bold: true }; subCell.alignment = { horizontal: 'center' };
                        currentRow++;

                        ['Peringkat', 'Nama Atlet', 'Kontingen', 'Nilai Akhir'].forEach((text, i) => {
                            let cell = sheet.getCell(currentRow, i + 1);
                            cell.value = text; cell.style = tableHeaderStyle;
                        });
                        currentRow++;

                        poolParts.sort((a, b) => b.scores.b1.final - a.scores.b1.final || b.scores.b1.tech - a.scores.b1.tech);
                        poolParts.forEach((p, i) => {
                            let rank = (i === 0) ? 1 : (i === 1) ? 2 : (i === 2 || i === 3) ? 3 : (i + 1);
                            let nilaiAkhir = parseFloat(p.scores.b1.final.toFixed(2));

                            // 🌟 PEMBERSIH KONTINGEN KHUSUS FESTIVAL 🌟
                            // Menghapus paksa akhiran rongsokan seperti (A), (H), (I), (1) di ujung nama kontingen
                            let cleanKontingen = p.kontingen.replace(/\s*\(([a-zA-Z]|[IVX]{1,3}|\d{1,2})\)$/i, '').trim();

                            let names = String(p.nama).split(/[,+&]/).map(n => n.trim()).filter(n => n);
                            if (names.length === 0) names = ["-"];
                            names.forEach((n, idx) => {
                                sheet.getCell(currentRow, 1).value = (idx === 0) ? rank : "";
                                sheet.getCell(currentRow, 2).value = n;
                                // 🌟 Gunakan Variabel Kontingen yang Sudah Dicuci Bersih 🌟
                                sheet.getCell(currentRow, 3).value = (idx === 0) ? cleanKontingen : "";
                                sheet.getCell(currentRow, 4).value = (idx === 0) ? nilaiAkhir : "";

                                [1, 2, 3, 4].forEach(colIdx => {
                                    let c = sheet.getCell(currentRow, colIdx);
                                    c.border = borderAll;
                                    c.alignment = { vertical: 'middle', horizontal: (colIdx === 2 || colIdx === 3) ? 'left' : 'center' };
                                });
                                currentRow++;
                            });
                        });
                    });
                    if (!adaPemenang) {
                        sheet.mergeCells(`A${currentRow}:D${currentRow}`);
                        let cell = sheet.getCell(`A${currentRow}`);
                        cell.value = "Belum ada nilai tersimpan";
                        cell.border = borderAll; cell.alignment = { horizontal: 'center' };
                        currentRow++;
                    }
                }
            }
            // --- JIKA DISIPLIN RANDORI (TANPA KOLOM NILAI) ---
            else {
                // Header Tabel khusus Randori
                ['Peringkat', 'Nama Atlet', 'Kontingen', 'Keterangan'].forEach((text, i) => {
                    let cell = sheet.getCell(currentRow, i + 1);
                    cell.value = text; cell.style = tableHeaderStyle;
                });
                currentRow++;

                let catMatches = STATE.matches.filter(m => m.kategori === cat.name);
                let hasPools = catMatches.some(m => m.pool === 'A' || m.pool === 'B');
                let isFinalCat = cat.name.toUpperCase().includes('FINAL');

                if (hasPools && !isFinalCat) {
                    sheet.mergeCells(`A${currentRow}:D${currentRow}`);
                    let cell = sheet.getCell(`A${currentRow}`);
                    cell.value = "Turnamen sistem Pool. Lihat kategori 'FINAL' untuk rekap juara akhir.";
                    cell.border = borderAll; cell.alignment = { horizontal: 'center' };
                    currentRow++;
                } else {
                    let poolResults = calculateRandoriFinalists(cat.name);
                    let foundFinalResult = false;

                    if (poolResults) {
                        poolResults.forEach(res => {
                            let isSinglePool = res.pool === '-';
                            if (isFinalCat || isSinglePool) {
                                foundFinalResult = true;
                                let label1 = isFinalCat || isSinglePool ? "Juara 1" : `Juara 1 Pool ${res.pool}`;
                                let label2 = isFinalCat || isSinglePool ? "Juara 2" : `Runner-Up Pool ${res.pool}`;
                                let baseLabel3 = res.perunggu.length > 1 ? "Juara 3 Bersama" : "Juara 3";
                                let label3 = isFinalCat || isSinglePool ? baseLabel3 : `${baseLabel3} Pool ${res.pool}`;

                                // Fungsi Cetak Baris Randori Internal
                                const printRandoriRow = (rank, rawName, kontingen, ket) => {
                                    if (!rawName) return;
                                    String(rawName).split(/[,+&]/).map(n => n.trim()).filter(n => n).forEach((n, idx) => {
                                        sheet.getCell(currentRow, 1).value = (idx === 0) ? rank : "";
                                        sheet.getCell(currentRow, 2).value = n;
                                        sheet.getCell(currentRow, 3).value = (idx === 0) ? kontingen : "";
                                        sheet.getCell(currentRow, 4).value = (idx === 0) ? ket : ""; // Memasukkan Status Medali

                                        [1, 2, 3, 4].forEach(colIdx => {
                                            let c = sheet.getCell(currentRow, colIdx);
                                            c.border = borderAll;
                                            c.alignment = { vertical: 'middle', horizontal: (colIdx === 2 || colIdx === 3 || colIdx === 4) ? 'left' : 'center' };
                                        });
                                        currentRow++;
                                    });
                                };

                                printRandoriRow(1, res.emas, res.emasKontingen, label1);
                                printRandoriRow(2, res.perak, res.perakKontingen, label2);
                                res.perunggu.forEach(p => printRandoriRow(3, p.nama, p.kontingen, label3));
                            }
                        });
                    }
                    if (!foundFinalResult) {
                        sheet.mergeCells(`A${currentRow}:D${currentRow}`);
                        let cell = sheet.getCell(`A${currentRow}`);
                        cell.value = "Belum ada pemenang / Menunggu pertandingan selesai";
                        cell.border = borderAll; cell.alignment = { horizontal: 'center' };
                        currentRow++;
                    }
                }
            }

            // Jarak Spasi antar tabel kategori 
            currentRow += 2;
        });

        // 3. COMPILE DAN PAKSA UNDUH SEBAGAI EXCEL
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");

        let prefix = filterCatName ? `Rekap_Juara_${filterCatName.replace(/[^a-zA-Z0-9]/g, '_')}` : `Rekapitulasi_Pemenang`;
        a.download = `${prefix}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        a.href = url;

        document.body.appendChild(a);
        a.click();

        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        document.body.style.cursor = 'default';

    } catch (err) {
        document.body.style.cursor = 'default';
        console.error(err);
        alert("Gagal mencetak Rekap Excel: " + err.message);
    }
}

function exportMedaliCSV() {
    let tally = {};
    const minPeserta = (STATE.settings && STATE.settings.minPesertaJuara) ? parseInt(STATE.settings.minPesertaJuara) : 1;

    STATE.categories.forEach(cat => {
        let catParts = STATE.participants.filter(p => p.kategori === cat.name);
        const isFinalCategory = cat.name.toUpperCase().includes('FINAL');

        let baseName = cat.name.replace(/FINAL/ig, '').trim().toLowerCase();
        let relatedParticipants = STATE.participants.filter(p => p.kategori.replace(/FINAL/ig, '').trim().toLowerCase() === baseName);
        let uniqueAthletes = new Set(relatedParticipants.map(p => p.nama.toLowerCase().trim()));
        let trueParticipantCount = uniqueAthletes.size;

        if (trueParticipantCount < minPeserta) return;

        if (cat.discipline === 'embu') {
            let hasFinalists = catParts.some(p => p.isFinalist);
            let targetParts = [];

            if (hasFinalists) {
                targetParts = catParts.filter(p => p.isFinalist && p.scores.b2.final > 0);
                targetParts.forEach(p => { p.calcFinal = p.scores.b2.final; p.calcTech = p.scores.b2.tech; });
            } else if (catParts.some(p => p.pool === 'SINGLE' || p.pool === '-')) {
                targetParts = catParts.filter(p => (p.pool === 'SINGLE' || p.pool === '-') && p.urut > 0);
                targetParts.forEach(p => {
                    let s1 = p.scores.b1.final || 0; let s2 = p.scores.b2.final || 0;
                    p.calcFinal = (s1 > 0 && s2 > 0) ? ((s1 + s2) / 2) : (s1 > 0 ? s1 : s2);
                    let t1 = p.scores.b1.tech || 0; let t2 = p.scores.b2.tech || 0;
                    p.calcTech = (s1 > 0 && s2 > 0) ? ((t1 + t2) / 2) : (s1 > 0 ? t1 : t2);
                });
            }

            let wins = targetParts.filter(p => p.calcFinal > 0).sort((a, b) => b.calcFinal - a.calcFinal || b.calcTech - a.calcTech);
            if (wins[0] && wins[0].kontingen) { tally[wins[0].kontingen] = tally[wins[0].kontingen] || { g: 0, s: 0, b: 0 }; tally[wins[0].kontingen].g++; }
            if (wins[1] && wins[1].kontingen) { tally[wins[1].kontingen] = tally[wins[1].kontingen] || { g: 0, s: 0, b: 0 }; tally[wins[1].kontingen].s++; }
            if (wins[2] && wins[2].kontingen) { tally[wins[2].kontingen] = tally[wins[2].kontingen] || { g: 0, s: 0, b: 0 }; tally[wins[2].kontingen].b++; }
        } else {
            const hasPools = catParts.some(p => p.pool === 'A' || p.pool === 'B');
            if (hasPools && !isFinalCategory) return;

            const poolResults = calculateRandoriFinalists(cat.name);
            if (!poolResults) return;

            poolResults.forEach(res => {
                if (res.emasKontingen) { tally[res.emasKontingen] = tally[res.emasKontingen] || { g: 0, s: 0, b: 0 }; tally[res.emasKontingen].g++; }
                if (res.perakKontingen) { tally[res.perakKontingen] = tally[res.perakKontingen] || { g: 0, s: 0, b: 0 }; tally[res.perakKontingen].s++; }
                res.perunggu.forEach(p => {
                    if (p.kontingen) { tally[p.kontingen] = tally[p.kontingen] || { g: 0, s: 0, b: 0 }; tally[p.kontingen].b++; }
                });
            });
        }
    });

    let leaderboard = Object.keys(tally).map(kontingen => ({ nama: kontingen, emas: tally[kontingen].g, perak: tally[kontingen].s, perunggu: tally[kontingen].b, total: tally[kontingen].g + tally[kontingen].s + tally[kontingen].b }));
    leaderboard.sort((a, b) => b.emas - a.emas || b.perak - a.perak || b.perunggu - a.perunggu);

    let rows = [["Peringkat", "Kontingen", "Emas", "Perak", "Perunggu", "Total Medali"]];
    leaderboard.forEach((k, i) => { rows.push([i + 1, k.nama, k.emas, k.perak, k.perunggu, k.total]); });
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF" + rows.map(e => e.map(cell => `"${cell}"`).join(";")).join("\n");

    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `Klasemen_Medali_Juara_Umum_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
}

function exportCustomCSV() { exportHasilCSV(null); } // Legacy fallback

// =========================================================
// FITUR ZONA BERBAHAYA (DIPISAH: NILAI & DRAWING)
// =========================================================

function resetSemuaNilai() {
    if (confirm('⚠️ HAPUS NILAI SAJA?\n\nIni akan mengosongkan SELURUH SKOR di semua kategori.\nBagan Randori dan Drawing Embu TIDAK AKAN DIHAPUS (Hanya dikembalikan ke ronde pertama).\n\nLanjutkan?')) {

        // 1. Bersihkan nilai di memori atlet, tapi biarkan urut & pool utuh
        STATE.participants.forEach(p => {
            p.scores = { b1: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 }, b2: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 } };
            p.finalScore = 0; p.techScore = 0; p.losses = 0;
        });

        // 2. Kembalikan bagan Randori ke status awal (Hapus pemenang & skor partai)
        STATE.matches = STATE.matches.filter(m => m.babak !== "SUDDEN DEATH"); // Sapu bersih partai dadakan
        STATE.matches.forEach(m => {
            if (m.col > 1) { m.merahId = null; m.putihId = null; } // Kosongkan atlet di babak lanjutan
            m.status = 'pending'; m.winnerId = null; m.loserId = null; m.skorMerah = 0; m.skorPutih = 0;
        });

        // Tembakkan ke Firebase
        let updates = {};
        updates['turnamen_data/participants'] = STATE.participants;
        updates['turnamen_data/matches'] = STATE.matches;

        database.ref().update(updates).then(() => {
            // Evaluasi ulang Auto-Win (BYE) karena bagan di-reset
            const randoriCats = [...new Set(STATE.matches.map(m => m.kategori))];
            randoriCats.forEach(catName => processAutoWins(catName));

            // Simpan state Auto-Win ke server lagi
            database.ref('turnamen_data/matches').set(STATE.matches);

            alert('✅ Berhasil: Semua Nilai telah dikosongkan. Bagan & Drawing tetap utuh!');
        }).catch(err => alert("Gagal Reset Nilai: " + err));
    }
}

function resetSemuaDrawing() {
    if (confirm('🚨 HAPUS DRAWING & BAGAN?\n\nIni akan mereset nomor undian seluruh atlet ke "Belum Diundi" dan MENGHAPUS SEMUA BAGAN RANDORI secara permanen.\n(Seluruh nilai juga otomatis terhapus).\n\nYakin ingin menghancurkan drawing?')) {

        // 1. Bersihkan nilai DAN reset seluruh atribut drawing
        STATE.participants.forEach(p => {
            p.scores = { b1: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 }, b2: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 } };
            p.finalScore = 0; p.techScore = 0; p.losses = 0;

            // RESET ATRIBUT DRAWING
            p.urut = 0;
            p.urutB2 = 0;
            p.pool = '-';
            p.isFinalist = false;
            p.urutFinal = 0;
        });

        // 2. Bakar seluruh data kerangka bagan
        STATE.matches = [];

        // Tembakkan perintah hapus spesifik ke Firebase
        let updates = {};
        updates['turnamen_data/participants'] = STATE.participants;
        updates['turnamen_data/matches'] = null; // 'null' di Firebase berarti HAPUS NODE SECARA PERMANEN

        database.ref().update(updates).then(() => {
            alert('✅ Berhasil: Semua Drawing, Bagan, dan Nilai telah dihancurkan ke status awal!');
        }).catch(err => alert("Gagal Reset Drawing: " + err));
    }
}

function resetDataAtlet() {
    if (confirm('⚠️ PERHATIAN: Ini MENGHAPUS SEMUA ATLET & BAGAN di seluruh jaringan. Yakin?')) {
        STATE.participants = [];
        STATE.matches = [];

        let updates = {};
        updates['turnamen_data/participants'] = null;
        updates['turnamen_data/matches'] = null;

        database.ref().update(updates).then(() => {
            alert('✅ Berhasil: Data Atlet dan Bagan telah dihapus dari server!');
        }).catch(err => alert("Gagal Hapus Atlet: " + err));
    }
}

function resetTotalSistem() {
    if (confirm('🚨 FACTORY RESET: Anda yakin ingin menghapus seluruh sistem (Kategori, Atlet, Nilai) secara permanen dari server?')) {

        // Tembak langsung ke inti Root Firebase (Wipe Out)
        // Kita hanya menyisakan kerangka kosong dan setting default
        database.ref('turnamen_data').set({
            settings: { numJudges: 5, minPesertaJuara: 1 }
        }).then(() => {
            alert('🔥 Kiamat selesai. Sistem kembali ke pengaturan pabrik.');
            location.reload();
        }).catch(err => alert("Gagal Factory Reset: " + err));
    }
}

// =========================================================
// FITUR BACKUP & RESTORE DATABASE (JSON)
// =========================================================

function backupDatabase() {
    // 1. Kumpulkan semua data STATE saat ini
    const dataToBackup = {
        categories: STATE.categories,
        participants: STATE.participants,
        matches: STATE.matches,
        settings: STATE.settings,
        backupDate: new Date().toISOString() // Catat waktu backup
    };

    // 2. Ubah jadi file JSON dan download
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dataToBackup, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `Backup_MASS_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function restoreDatabase(event) {
    const file = event.target.files[0];
    if (!file) return;

    // 1. Peringatan keras sebelum menimpa data server
    if (!confirm("⚠️ PERINGATAN KRITIS!\n\nMere-store data akan MENGHAPUS & MENIMPA seluruh data turnamen online saat ini dengan data dari file.\n\nApakah Anda sangat yakin ingin melanjutkan?")) {
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            // 2. Baca isi file JSON
            const importedData = JSON.parse(e.target.result);

            // 3. Validasi keamanan sederhana
            if (!importedData.categories && !importedData.participants) {
                throw new Error("Format file JSON tidak valid atau bukan file backup MASS.");
            }

            // 4. Tembakkan langsung ke Firebase Database!
            // (Tidak perlu saveToLocalStorage karena listener Firebase akan otomatis 
            // menarik data ini dan merefresh layar di SEMUA laptop panitia secara instan)
            database.ref('turnamen_data').set({
                categories: importedData.categories || [],
                participants: importedData.participants || [],
                matches: importedData.matches || [],
                settings: importedData.settings || { numJudges: 5, minPesertaJuara: 1 }
            }).then(() => {
                alert("✅ RESTORE BERHASIL!\nData turnamen telah dipulihkan dan disinkronkan ke seluruh jaringan.");
            }).catch(err => {
                alert("❌ GAGAL RESTORE ke Server: " + err.message);
            });

        } catch (error) {
            alert("❌ GAGAL MEMBACA FILE:\n" + error.message);
        } finally {
            event.target.value = ''; // Reset input
        }
    };
    reader.readAsText(file);
}
// ==========================================
// FITUR KLIK-UNTUK-TUKAR URUTAN EMBU
// ==========================================
function handleEmbuSwap(participantId, poolType) {
    const catName = document.getElementById('draw-select-kategori').value;
    if (!catName) return;

    // 1. Jika belum ada yang diklik sebelumnya
    if (!EMBU_SWAP_SELECTION) {
        EMBU_SWAP_SELECTION = { id: participantId, type: poolType };
        checkExistingDrawing();
        return;
    }

    // 2. Batal jika mengklik orang yang persis sama
    if (EMBU_SWAP_SELECTION.id === participantId && EMBU_SWAP_SELECTION.type === poolType) {
        EMBU_SWAP_SELECTION = null;
        checkExistingDrawing();
        return;
    }

    // 3. Mencegah error jika klik menyilang (B1 disilang ke B2)
    if (EMBU_SWAP_SELECTION.type !== poolType) {
        EMBU_SWAP_SELECTION = { id: participantId, type: poolType };
        checkExistingDrawing();
        return;
    }

    // 4. TEMUKAN INDEX ATLET UNTUK UPDATE GRANULAR
    let p1Index = STATE.participants.findIndex(p => p.id === EMBU_SWAP_SELECTION.id);
    let p2Index = STATE.participants.findIndex(p => p.id === participantId);

    if (p1Index > -1 && p2Index > -1) {
        let p1 = STATE.participants[p1Index];
        let p2 = STATE.participants[p2Index];

        // Tukar Urutan
        if (poolType === 'b1') {
            let tempUrut = p1.urut; p1.urut = p2.urut; p2.urut = tempUrut;
            let tempPool = p1.pool; p1.pool = p2.pool; p2.pool = tempPool;
        } else if (poolType === 'b2') {
            let tempUrutB2 = p1.urutB2; p1.urutB2 = p2.urutB2; p2.urutB2 = tempUrutB2;
        } else if (poolType === 'final') {
            let tempUrutFinal = p1.urutFinal; p1.urutFinal = p2.urutFinal; p2.urutFinal = tempUrutFinal;
        }

        // 5. BERSIHKAN MEMORI SEKARANG JUGA (Agar seleksi langsung hilang)
        EMBU_SWAP_SELECTION = null;

        // 6. UPDATE LAYAR LOKAL SECARA INSTAN (Tanpa menunggu balasan server)
        checkExistingDrawing();
        if (typeof filterPesertaScoring === 'function') filterPesertaScoring();

        // 7. TEMBAKAN SNIPER KE FIREBASE (Hanya update 2 atlet ini secara diam-diam di background)
        let updates = {};
        updates[`turnamen_data/participants/${p1Index}`] = p1;
        updates[`turnamen_data/participants/${p2Index}`] = p2;

        database.ref().update(updates).catch(err => console.error("Gagal menukar di server: " + err));

    } else {
        EMBU_SWAP_SELECTION = null;
        checkExistingDrawing();
    }
}
// =========================================================
// SISTEM TOGGLE BROADCAST TV (MARATON TV LIVE)
// =========================================================
document.addEventListener('DOMContentLoaded', () => {
    let roleSelect = document.getElementById('setting-device-role');
    if (roleSelect) roleSelect.value = DEVICE_ROLE;
    if (typeof updateBroadcastUI === "function") updateBroadcastUI();
});

function changeDeviceRole() {
    DEVICE_ROLE = document.getElementById('setting-device-role').value;
    localStorage.setItem('mass_device_role', DEVICE_ROLE);
    updateBroadcastUI();
    alert(`Perangkat diubah menjadi: ${DEVICE_ROLE.replace('_', ' ').toUpperCase()}`);
}

function toggleBroadcast() {
    if (DEVICE_ROLE === 'admin') return alert('Ubah peran ke Tatami/Court di Tab Admin terlebih dahulu!');

    // 🔥 HANYA VALIDASI PILIHAN PESERTA SAAT HENDAK MENYALAKAN TV
    if (!IS_TV_LIVE) {
        const val = document.getElementById('select-peserta') ? document.getElementById('select-peserta').value : '';
        if (!val) return alert('Pilih pertandingan/atlet terlebih dahulu!');
    }

    IS_TV_LIVE = !IS_TV_LIVE;
    updateBroadcastUI();

    if (IS_TV_LIVE) {
        const val = document.getElementById('select-peserta') ? document.getElementById('select-peserta').value : '';
        if (val.startsWith('match-')) {
            pushRandoriToTV();
        } else {
            updateScoringButtonsUI();
        }
    } else {
        // Matikan TV secara senyap dengan payload idle
        const payload = {
            payload_id: Date.now().toString() + "-" + Math.floor(Math.random() * 10000),
            current_action: 'idle'
        };
        if (database) database.ref(`live_broadcast/${DEVICE_ROLE}`).set(payload).catch(e => console.warn(e));
        if (typeof localSocket !== 'undefined' && localSocket) {
            localSocket.emit('broadcast_to_tv', { channel: 'global_tv', court: DEVICE_ROLE, payload: payload });
        }
    }
}

function updateBroadcastUI() {
    const btnOpenTV = document.getElementById('btn-open-tv');
    const btn = document.getElementById('btn-broadcast-toggle');
    const icon = document.getElementById('icon-broadcast');
    const text = document.getElementById('text-broadcast');

    if (DEVICE_ROLE !== 'admin') {
        if (btnOpenTV) { btnOpenTV.classList.remove('hidden'); btnOpenTV.href = `display.html?court=${DEVICE_ROLE}`; }
        if (btn) { btn.classList.remove('hidden'); btn.style.display = 'flex'; }
    } else {
        if (btnOpenTV) btnOpenTV.classList.add('hidden');
        if (btn) { btn.classList.add('hidden'); btn.style.display = 'none'; }
        return;
    }

    if (!btn || !icon || !text) return;

    if (IS_TV_LIVE) {
        btn.className = "w-full mt-3 bg-red-900/40 hover:bg-red-800 border border-red-500 text-red-400 font-bold py-2.5 px-4 rounded-lg shadow-[0_0_15px_rgba(220,38,38,0.4)] text-xs transition-all flex items-center justify-center gap-2 tracking-widest";
        icon.className = "fas fa-tv animate-pulse text-sm";
        text.innerText = "LIVE DI TV";
    } else {
        btn.className = "w-full mt-3 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-400 font-bold py-2.5 px-4 rounded-lg shadow-md text-xs transition-all flex items-center justify-center gap-2 tracking-widest";
        icon.className = "fas fa-tv-slash text-sm";
        text.innerText = "TV OFFLINE";
    }
}

function pushRandoriToTV() {
    if (DEVICE_ROLE === 'admin' || !currentRandoriMatchId || !IS_TV_LIVE) return;

    const match = STATE.matches.find(m => m.id === currentRandoriMatchId);
    if (!match) return;

    const mrh = STATE.participants.find(p => p.id === match.merahId) || { nama: '-', kontingen: '-' };
    const pth = STATE.participants.find(p => p.id === match.putihId) || { nama: '-', kontingen: '-' };
    let timerFmt = `${Math.floor(UI.timerSeconds / 60).toString().padStart(2, '0')}:${(UI.timerSeconds % 60).toString().padStart(2, '0')}`;

    const payload = {
        type: 'randori',
        kategori: match.kategori,
        waktu: timerFmt,
        merah: {
            nama: mrh.nama,
            kontingen: mrh.kontingen,
            skor: RANDORI_STATE.merah.score,
            warnings: RANDORI_STATE.merah.warnings || 0
        },
        putih: {
            nama: pth.nama,
            kontingen: pth.kontingen,
            skor: RANDORI_STATE.putih.score,
            warnings: RANDORI_STATE.putih.warnings || 0
        }
    };

    // 1. Tembak via Firebase RTDB
    if (database) database.ref(`live_broadcast/${DEVICE_ROLE}`).set(payload).catch(e => console.warn(e));

    // 2. Tembak via Socket.io Lokal
    if (typeof localSocket !== 'undefined' && localSocket && localSocket.connected) {
        localSocket.emit('broadcast_to_tv', { channel: 'global_tv', court: DEVICE_ROLE, payload: payload });
    }
}

// FUNGSI PENYIAR PEMENANG H2H KE TV
function tampilkanPemenangH2H_TV() {
    const val = document.getElementById('select-peserta').value;
    if (!val || !val.startsWith('h2h-match-')) return;
    if (DEVICE_ROLE === 'admin' || !IS_TV_LIVE) return alert("Nyalakan tombol 'LIVE DI TV' warna merah di kiri layar terlebih dahulu!");

    const matchId = parseInt(val.split('-')[2]);
    const m = STATE.matches.find(x => x.id === matchId);
    if (!m || !m.skorMerah || !m.skorPutih) return;

    const mrh = STATE.participants.find(p => p.id === m.merahId) || { nama: '-', kontingen: '-' };
    const pth = STATE.participants.find(p => p.id === m.putihId) || { nama: '-', kontingen: '-' };

    // FUNGSI EKSEKUSI SIARAN JUARA KE LAYAR TV & KUNCI BAGAN[cite: 1]
    const eksekusiTayanganJuara = (finalWinnerCorner) => {
        m.winnerId = finalWinnerCorner === 'merah' ? m.merahId : m.putihId;
        m.loserId = finalWinnerCorner === 'merah' ? m.putihId : m.merahId;
        m.status = 'done';

        // Majukan atlet di bagan turnamen[cite: 1]
        recalculateAllLosses(m.kategori); //[cite: 1]
        forwardParticipant(m.nextW, m.winnerId, m.kategori, m.pool, m.nextWSlot); //[cite: 1]
        if (m.nextL) forwardParticipant(m.nextL, m.loserId, m.kategori, m.pool, m.nextLSlot); //[cite: 1]
        processAutoWins(m.kategori); //[cite: 1]
        saveToLocalStorage(); //[cite: 1]

        const payload = {
            type: 'embu_h2h_winner',
            payload_id: Date.now().toString() + "-" + Math.floor(Math.random() * 10000),
            match_data: {
                kategori: m.kategori,
                merah: { nama: formatNama(mrh.nama, 'inline'), kontingen: mrh.kontingen, skor: m.skorMerah, teknik: m.tbMerahW1 || 0 }, //[cite: 1]
                putih: { nama: formatNama(pth.nama, 'inline'), kontingen: pth.kontingen, skor: m.skorPutih, teknik: m.tbPutihW1 || 0 }, //[cite: 1]
                pemenang: finalWinnerCorner
            }
        };

        if (typeof localSocket !== 'undefined' && localSocket && localSocket.connected) {
            localSocket.emit('broadcast_to_tv', { channel: 'global_tv', court: DEVICE_ROLE, payload: payload });
        }
        if (database) database.ref(`live_broadcast/${DEVICE_ROLE}`).set(payload);

        // Dialog konfirmasi lanjut partai setelah seremoni TV berjalan[cite: 1]
        setTimeout(() => {
            if (confirm("📺 Layar TV sedang menayangkan SANG JUARA H2H!\n\nKlik 'OK' untuk membuka panel antrean / lanjut ke partai berikutnya.")) {
                HOLD_H2H_SCREEN = false;
                filterPesertaScoring(); //[cite: 1]

                if (ACTIVE_PLAYLIST.isActive) {
                    autoNextPlaylistMatch(); //[cite: 1]
                } else {
                    let selectEl = document.getElementById('select-peserta');
                    if (selectEl && selectEl.selectedIndex < selectEl.options.length - 1) {
                        selectEl.selectedIndex++;
                        const event = new Event('change');
                        selectEl.dispatchEvent(event);
                    }
                }
            }
        }, 600);
    };

    // LOGIKA PENENTUAN: JIKA SERI BUKA MODAL, JIKA MUTLAK LANGSUNG TAYANGKAN
    if (m.skorMerah === m.skorPutih) {
        let tb1M = m.tbMerahW1 || 0;
        let tb1P = m.tbPutihW1 || 0;
        let tb2M = m.tb2Merah || 0;
        let tb2P = m.tb2Putih || 0;

        let tbData = {
            tb1Merah: tb1M, tb1Putih: tb1P,
            tb2Merah: tb2M, tb2Putih: tb2P,
            level: 1, winner: '', winnerVal: 0, loserVal: 0
        };

        if (tb1M !== tb1P) {
            tbData.level = 1; // Wasit Utama
            tbData.winner = tb1M > tb1P ? 'merah' : 'putih';
            tbData.winnerVal = Math.max(tb1M, tb1P);
            tbData.loserVal = Math.min(tb1M, tb1P);
        } else if (tb2M !== tb2P) {
            tbData.level = 2; // Total Wasit Sah
            tbData.winner = tb2M > tb2P ? 'merah' : 'putih';
            tbData.winnerVal = Math.max(tb2M, tb2P);
            tbData.loserVal = Math.min(tb2M, tb2P);
        } else {
            tbData.level = 3; // Deadlock Mutlak
        }

        // Buka Pop-Up Interaktif untuk MC
        showTieBreakerModalH2H(m, mrh, pth, tbData, (pemenangSah) => {
            eksekusiTayanganJuara(pemenangSah);
        });
    } else {
        // Pemenang mutlak dari skor akhir
        let winCorner = m.skorMerah > m.skorPutih ? 'merah' : 'putih';
        eksekusiTayanganJuara(winCorner);
    }
}

// =========================================================
// ENGINE EXCELJS: GENERATOR BAGAN RANDORI OTOMATIS (REVISI)
// =========================================================

async function generateBaganExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Pastikan library ExcelJS sudah dimuat
    if (typeof ExcelJS === 'undefined') {
        alert("Library ExcelJS belum termuat. Periksa koneksi internet Anda.");
        return;
    }

    try {
        // Notifikasi proses berjalan
        document.body.style.cursor = 'wait';
        const notif = document.createElement('div');
        notif.id = 'excel-loading';
        notif.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white font-bold px-6 py-3 rounded-lg shadow-2xl z-[100] animate-bounce';
        notif.innerHTML = '<i class="fas fa-cog fa-spin mr-2"></i>Sedang Merakit File Excel...';
        document.body.appendChild(notif);

        // 1. Muat Workbook Template
        const arrayBuffer = await file.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(arrayBuffer);

        // Cari master template (Toleransi nama huruf besar/kecil)
        const templates = {
            t4: workbook.worksheets.find(s => s.name.toUpperCase().includes('BAGAN 4')),
            t8S: workbook.worksheets.find(s => s.name.toUpperCase().includes('BAGAN 8 (SINGLE)') || s.name.toUpperCase().includes('BAGAN 8(SINGLE)')),
            t8A: workbook.worksheets.find(s => s.name.toUpperCase().includes('BAGAN 8 (A)') || s.name.toUpperCase().includes('BAGAN 8(A)')),
            t8B: workbook.worksheets.find(s => s.name.toUpperCase().includes('BAGAN 8 (B)') || s.name.toUpperCase().includes('BAGAN 8(B)'))
        };

        if (!templates.t4 || !templates.t8S || !templates.t8A || !templates.t8B) {
            alert("⚠️ GAGAL!\nFile Excel Anda tidak memiliki nama sheet template yang lengkap.\nPastikan ada sheet:\n- BAGAN 4\n- BAGAN 8 (SINGLE)\n- BAGAN 8 (A)\n- BAGAN 8 (B)");
            throw new Error("Template tidak lengkap");
        }

        // 2. Filter hanya kategori Randori
        const randoriCats = STATE.categories.filter(c => c.discipline === 'randori');

        if (randoriCats.length === 0) {
            alert("Belum ada data kategori Randori.");
            throw new Error("Data Kosong");
        }

        // 3. Proses Looping per Kategori
        for (const cat of randoriCats) {
            // SAMA PERSIS DENGAN exportDrawingCSV: Sortir mutlak berdasarkan matchNum
            let catMatches = STATE.matches.filter(m => m.kategori === cat.name).sort((a, b) => a.matchNum - b.matchNum);
            if (catMatches.length === 0) continue; // Skip jika belum diundi

            let isFinalCat = cat.name.toUpperCase().includes('FINAL');
            let unikPools = [...new Set(catMatches.map(m => m.pool))];

            // Proses pembuatan Sheet per Pool
            for (const poolName of unikPools) {
                // Hitung total peserta nyata di pool ini untuk penentuan Template
                let pCount = STATE.participants.filter(p => p.kategori === cat.name && (p.pool === poolName || p.pool === '-' || p.pool === 'SINGLE')).length;

                let targetTemplate;

                // LOGIKA CERDAS PEMILIHAN TEMPLATE:
                if (isFinalCat || pCount <= 4) {
                    targetTemplate = templates.t4;
                } else if (pCount > 4 && pCount <= 8) {
                    if (poolName === 'A') targetTemplate = templates.t8A;
                    else if (poolName === 'B') targetTemplate = templates.t8B;
                    else targetTemplate = templates.t8S; // Single Pool
                } else {
                    // Jika > 8, paksa template 8 sesuai rancangan awal
                    if (poolName === 'A') targetTemplate = templates.t8A;
                    else if (poolName === 'B') targetTemplate = templates.t8B;
                    else targetTemplate = templates.t8S;
                }

                // Buat Nama Singkat Aman untuk Sheet (Max 31 Char, Tanpa Karakter Ilegal)
                let shortName = cat.name
                    .replace(/Randori/ig, 'R')
                    .replace(/Putra/ig, 'Pa')
                    .replace(/Putri/ig, 'Pi')
                    .replace(/Kelas/ig, 'Kl')
                    .replace(/Campuran/ig, 'Cmp');

                let poolSuffix = poolName !== '-' ? `_${poolName}` : '';
                let safeSheetName = (shortName + poolSuffix).substring(0, 31).replace(/[:\/\?\*\[\]]/g, '');

                // Hindari duplikasi nama sheet
                let suffixCounter = 1;
                let finalSheetName = safeSheetName;
                while (workbook.getWorksheet(finalSheetName)) {
                    finalSheetName = `${safeSheetName.substring(0, 28)}_${suffixCounter}`;
                    suffixCounter++;
                }

                // --- PROSES KLONING SHEET & FORMAT CETAK (PRINT AREA) ---
                let newSheet = workbook.addWorksheet(finalSheetName);

                // Kloning Lebar Kolom
                targetTemplate.columns.forEach((col, idx) => {
                    let newCol = newSheet.getColumn(idx + 1);
                    if (col.width) newCol.width = col.width;
                    if (col.style) newCol.style = col.style;
                });

                // Kloning Tinggi Baris & Nilai/Warna Sel
                targetTemplate.eachRow({ includeEmpty: true }, (row, rowNum) => {
                    let newRow = newSheet.getRow(rowNum);
                    if (row.height) newRow.height = row.height;
                    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
                        let newCell = newRow.getCell(colNum);
                        newCell.value = cell.value;
                        newCell.style = cell.style;
                    });
                });

                // Kloning Merge Cell
                if (targetTemplate._merges) {
                    Object.values(targetTemplate._merges).forEach(merge => {
                        newSheet.mergeCells(merge.model.top, merge.model.left, merge.model.bottom, merge.model.right);
                    });
                }

                // Kloning Gambar / Kop Surat
                const sheetImages = targetTemplate.getImages();
                if (sheetImages && sheetImages.length > 0) {
                    sheetImages.forEach(img => {
                        newSheet.addImage(img.imageId, img.range);
                    });
                }

                // KLONING PAGE SETUP (Penting untuk Format Cetak / Print Area)
                newSheet.pageSetup = Object.assign({}, targetTemplate.pageSetup);
                if (targetTemplate.views) {
                    newSheet.views = JSON.parse(JSON.stringify(targetTemplate.views));
                }

                // --- INJEKSI DATA KE KOORDINAT SPESIFIK (REVISI ALIGNMENT) ---
                const COL_DISIPLIN = 18; // R
                const COL_KATEGORI = 19; // S
                const COL_POOL = 20; // T
                const COL_PARTAI = 21; // U
                const COL_N_MRH = 22; // V
                const COL_K_MRH = 23; // W
                const COL_S_MRH = 24; // X (Skor Merah - FIXED)
                const COL_N_PTH = 25; // Y (Sudut Putih - FIXED)
                const COL_K_PTH = 26; // Z (Kontingen Putih - FIXED)
                const COL_S_PTH = 27; // AA (Skor Putih - FIXED)
                const COL_STATUS = 28; // AB (Status - FIXED)

                let startRow = 3; // Mulai Baris ke-3 (FIXED)

                // Inject SEMUA partai sekategori agar absolute row sama persis dengan fungsi CSV
                catMatches.forEach((match, idx) => {
                    let mrh = STATE.participants.find(p => p.id === match.merahId);
                    let pth = STATE.participants.find(p => p.id === match.putihId);

                    let nMrh = match.merahId === -1 ? "BYE" : (mrh ? mrh.nama : "Menunggu");
                    let kMrh = match.merahId === -1 ? "-" : (mrh ? mrh.kontingen : "-");
                    let nPth = match.putihId === -1 ? "BYE" : (pth ? pth.nama : "Menunggu");
                    let kPth = match.putihId === -1 ? "-" : (pth ? pth.kontingen : "-");

                    let displayNum = match.matchNum % 50 === 0 ? 50 : match.matchNum % 50;

                    // --- PERBAIKAN COMPOSITE KEY ---
                    let poolCode = match.pool;
                    let isFinalCat = cat.name.toUpperCase().includes('FINAL'); // Deteksi Crossover Final

                    // Kode 'S' hanya untuk Final Crossover atau kelas yang murni Single Pool
                    if (isFinalCat || poolCode === '-' || poolCode === 'SINGLE') {
                        poolCode = 'S';
                    }
                    let compositeKey = `${poolCode}-G-${displayNum}`;
                    // ------------------------------

                    let currentRow = startRow + idx;

                    newSheet.getCell(currentRow, COL_DISIPLIN).value = "RANDORI";
                    newSheet.getCell(currentRow, COL_KATEGORI).value = cat.name;
                    // Kembalikan ke teks Pool / Babak asli yang bisa dibaca panitia
                    newSheet.getCell(currentRow, COL_POOL).value = `${match.pool !== '-' ? 'Pool ' + match.pool : 'Utama'} - ${match.babak}`;
                    // Tembak Composite Key di kolom No. Partai untuk dieksekusi rumus VLOOKUP
                    newSheet.getCell(currentRow, COL_PARTAI).value = compositeKey;
                    newSheet.getCell(currentRow, COL_N_MRH).value = nMrh;
                    newSheet.getCell(currentRow, COL_K_MRH).value = kMrh;
                    newSheet.getCell(currentRow, COL_S_MRH).value = match.skorMerah > 0 ? match.skorMerah : 0;
                    newSheet.getCell(currentRow, COL_N_PTH).value = nPth;
                    newSheet.getCell(currentRow, COL_K_PTH).value = kPth;
                    newSheet.getCell(currentRow, COL_S_PTH).value = match.skorPutih > 0 ? match.skorPutih : 0;
                    newSheet.getCell(currentRow, COL_STATUS).value = match.status === 'done' ? "Selesai" : "";
                });
            }
        }

        // 4. Penghancuran Template Asli agar file bersih
        workbook.removeWorksheet(templates.t4.id);
        workbook.removeWorksheet(templates.t8S.id);
        workbook.removeWorksheet(templates.t8A.id);
        workbook.removeWorksheet(templates.t8B.id);

        // 5. Konversi dan Paksa Unduh
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Bagan_Randori_Lengkap_${new Date().toISOString().slice(0, 10)}.xlsx`;

        document.body.appendChild(a);
        a.click();

        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        // Selesai
        document.body.style.cursor = 'default';
        document.body.removeChild(notif);
        event.target.value = ''; // Reset input agar bisa klik file yang sama lagi

        alert("✅ BERHASIL!\nBagan Excel otomatis berhasil di-generate dan diunduh.");

    } catch (error) {
        document.body.style.cursor = 'default';
        const notif = document.getElementById('excel-loading');
        if (notif) notif.remove();
        event.target.value = '';
        console.error(error);
        alert("Terjadi kesalahan saat memproses Excel: " + error.message);
    }
}

// =========================================================
// MESIN SINKRONISASI DATA PENDAFTARAN (FIRESTORE TO RTDB)
// =========================================================
async function tarikDataPendaftaran() {
    if (!confirm("🚀 TARIK DATA PENDAFTARAN?\n\nSistem akan menyedot data dari server Pendaftaran (Firestore) dan memasukkannya ke dalam MASS KEMPO.\nData yang sudah ada tidak akan diduplikasi.\n\nLanjutkan?")) return;

    try {
        document.body.style.cursor = 'wait';

        // 1. Sedot data dari koleksi 'pendaftaran_t2'
        const snapshot = await firestoreDB.collection('pendaftaran_t2').get();

        let newParticipants = [];
        let addedCategories = new Set();
        let successCount = 0;

        snapshot.forEach(doc => {
            const data = doc.data();
            if (!data.kelas || !data.atlet || !data.kontingen) return; // Skip jika data cacat

            let namaList = [];
            let kyuList = [];
            let umurList = [];

            // 2. Operasi Pemecahan String (NAMA | KYU | TGL)
            data.atlet.forEach(atletStr => {
                let parts = atletStr.split('|').map(s => s.trim());
                if (parts[0]) namaList.push(parts[0]);
                if (parts[1]) kyuList.push(parts[1]);
                if (parts[2]) {
                    let birthYear = new Date(parts[2]).getFullYear();
                    let currentYear = new Date().getFullYear();
                    umurList.push(currentYear - birthYear);
                }
            });

            // 3. Jahit nama menjadi satu baris (Arif & Budi & Candra)
            let combinedName = namaList.join(' & ');
            let combinedKyu = kyuList.length > 0 ? kyuList[0] : ""; // Ambil kyu orang pertama sebagai perwakilan
            let maxUmur = umurList.length > 0 ? Math.max(...umurList) : 0; // Ambil umur tertua

            // --- PIPA NORMALISASI (DATA SANITIZATION) ---
            let catNameRaw = data.kelas;
            let kontingenFinal = data.kontingen;

            // Saringan Regex: Deteksi kurung berisi 1 Huruf, Angka, atau Romawi di UJUNG kalimat
            // Berlaku untuk: " (A)", " (B)", " (I)", " (1)", dll. Kata "(Putra)" akan kebal.
            const suffixRegex = /\s*\(([a-zA-Z]|[IVX]{1,3}|\d{1,2})\)$/i;
            let matchSuffix = catNameRaw.match(suffixRegex);

            let catName = catNameRaw; // Default jika tidak ada ekor

            if (matchSuffix) {
                catName = catNameRaw.replace(suffixRegex, '').trim(); // Potong ekor dari Kategori
                kontingenFinal = `${data.kontingen} (${matchSuffix[1].toUpperCase()})`; // Pindah ekor ke Kontingen
            }
            // --- AKHIR PIPA NORMALISASI ---

            // 4. Auto-Create Kategori (Jika belum ada di MASS KEMPO)
            if (!STATE.categories.some(c => c.name === catName)) {
                let discRaw = catName.toLowerCase();
                let discipline = discRaw.includes('randori') ? 'randori' : (discRaw.includes('festival') ? 'festival' : 'embu');

                STATE.categories.push({
                    id: Date.now() + Math.random(),
                    name: catName,
                    type: namaList.length, // Otomatis deteksi Format (1, 2, atau 3+)
                    discipline: discipline
                });
                addedCategories.add(catName);
            }

            // 5. TEMBAK JITU: Cari berdasarkan idFirestore ATAU pencocokan literal (untuk update data lama)
            let existingIndex = STATE.participants.findIndex(p =>
                (p.idFirestore === doc.id) ||
                (!p.idFirestore && p.nama === combinedName && p.kategori === catName && p.kontingen === kontingenFinal)
            );

            if (existingIndex > -1) {
                // DATA DITEMUKAN: Lakukan Precision Update
                let p = STATE.participants[existingIndex];
                p.idFirestore = doc.id;
                p.nama = combinedName;
                p.kyu = combinedKyu;
                p.umur = maxUmur;
                p.kontingen = kontingenFinal;
                // WAZA DIBUANG DARI SINI: RTDB tetap bersih!
            } else {
                // DATA BARU: Masukkan sebagai pendaftar fresh
                newParticipants.push({
                    id: Date.now() + successCount++,
                    idFirestore: doc.id,
                    nama: combinedName,
                    kontingen: kontingenFinal,
                    kategori: catName,
                    kyu: combinedKyu,
                    umur: maxUmur,
                    // WAZA DIBUANG DARI SINI: RTDB tetap bersih!
                    urut: 0, pool: '-', isFinalist: false, urutFinal: 0, losses: 0,
                    scores: { b1: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 }, b2: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 } },
                    finalScore: 0, techScore: 0
                });
            }
        });

        // 6. Simpan Perubahan ke MASS KEMPO
        // Karena ada Precision Update (edit data tanpa push baru), kita update jika ada dokumen di snapshot
        if (newParticipants.length > 0 || addedCategories.size > 0 || !snapshot.empty) {
            STATE.participants = STATE.participants.concat(newParticipants);

            let updates = {};
            updates['turnamen_data/categories'] = STATE.categories;
            updates['turnamen_data/participants'] = STATE.participants;

            await database.ref().update(updates);
            refreshAllData();

            alert(`✅ SINKRONISASI TEMBAK JITU SUKSES!\n\n- Menarik ${newParticipants.length} Peserta Baru.\n- Memperbarui otomatis jika ada nama/typo yang direvisi.\n- Termasuk ${addedCategories.size} Nomor Kelas baru.`);
        } else {
            alert("Sistem Anda sudah Up-To-Date. Tidak ada data pendaftar sama sekali.");
        }

    } catch (error) {
        console.error("Gagal Tarik Data:", error);
        alert("Terjadi kesalahan saat menyedot data: " + error.message);
    } finally {
        document.body.style.cursor = 'default';
    }
}

// =========================================================
// MESIN KECERDASAN WAKTU EMBU (AUTO-DETECT RULES)
// =========================================================
function getEmbuTimeRule(catName) {
    // Standar baku jika admin belum pernah menyetting sama sekali
    let rules = (STATE.settings && STATE.settings.timeRules) ? STATE.settings.timeRules : {
        tandoku: { min: 60, max: 75 },
        pemula: { min: 60, max: 90 },
        default: { min: 90, max: 120 }
    };

    let nameUpper = String(catName).toUpperCase();

    // Hirarki Kasta Pendeteksian Teks
    if (nameUpper.includes("TANDOKU")) {
        return { type: "TANDOKU", min: parseInt(rules.tandoku.min), max: parseInt(rules.tandoku.max) };
    } else if (nameUpper.includes("PEMULA")) {
        return { type: "PEMULA", min: parseInt(rules.pemula.min), max: parseInt(rules.pemula.max) };
    } else {
        return { type: "REMAJA / DEWASA (DEFAULT)", min: parseInt(rules.default.min), max: parseInt(rules.default.max) };
    }
}

function openTimeModal() {
    let rules = (STATE.settings && STATE.settings.timeRules) ? STATE.settings.timeRules : {
        tandoku: { min: 60, max: 75 }, pemula: { min: 60, max: 90 }, default: { min: 90, max: 120 }
    };
    document.getElementById('t-tandoku-min').value = rules.tandoku.min;
    document.getElementById('t-tandoku-max').value = rules.tandoku.max;
    document.getElementById('t-pemula-min').value = rules.pemula.min;
    document.getElementById('t-pemula-max').value = rules.pemula.max;
    document.getElementById('t-default-min').value = rules.default.min;
    document.getElementById('t-default-max').value = rules.default.max;
    document.getElementById('time-modal').classList.remove('hidden');
}

function closeTimeModal() { document.getElementById('time-modal').classList.add('hidden'); }

document.getElementById('form-time-rules').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!STATE.settings) STATE.settings = {};
    STATE.settings.timeRules = {
        tandoku: { min: document.getElementById('t-tandoku-min').value, max: document.getElementById('t-tandoku-max').value },
        pemula: { min: document.getElementById('t-pemula-min').value, max: document.getElementById('t-pemula-max').value },
        default: { min: document.getElementById('t-default-min').value, max: document.getElementById('t-default-max').value }
    };
    saveToLocalStorage(); // Kirim aturan baru ini ke server agar Tatami lain tahu
    closeTimeModal();
    alert("Standar Waktu Embu berhasil diperbarui untuk semua lapangan!");
});

// =========================================================
// SISTEM KENDALI PROYEKTOR TM (TECHNICAL MEETING)
// =========================================================
function bukaProyektorTM() {
    window.open('display-drawing.html', '_blank');
}

function updateProjectorPhase() {
    const phase = document.getElementById('select-projector-phase').value;
    database.ref('turnamen_data/settings/projectorPhase').set(phase);
}

// =========================================================
// SISTEM PAPERLESS VERIFICATION (BARCODE & SMART ASSIGN)
// =========================================================

function saveVerifikatorSetting() {
    if (!STATE.settings) STATE.settings = {};
    STATE.settings.enableVerifikator = document.getElementById('setting-verifikator').checked;
    saveToLocalStorage();
    alert("Sistem Verifikasi Barcode " + (STATE.settings.enableVerifikator ? "DIAKTIFKAN" : "DIMATIKAN"));
}

// 1. MANAJEMEN MASTER DATA (ADMIN)
function openMasterBarcodeModal() {
    document.getElementById('barcode-modal').classList.remove('hidden');
    renderMasterBarcodeList();
}
function closeMasterBarcodeModal() {
    document.getElementById('barcode-modal').classList.add('hidden');
}

function handleBarcodeCSVUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const rows = e.target.result.split('\n');
        let count = 0;
        rows.forEach((row, i) => {
            // 🌟 PERBAIKAN 1: Hapus aturan i === 0 agar baris pertama tidak dibuang otomatis
            if (!row.trim()) return;

            let cols = row.split(',').map(item => item.replace(/^"|"$/g, '').trim());

            // 🌟 PERBAIKAN 2: Deteksi Cerdas! Jika baris pertama adalah Header (ada kata "nama"), baru dilewati
            if (cols[0].toLowerCase().includes('nama')) return;

            if (cols.length >= 2) {
                const nama = cols[0];
                const jabatan = cols[1]; // WASIT atau OFFICIAL
                const kontingen = cols[2] || "-";

                if (nama && !STATE.barcodes.some(b => b.nama.toLowerCase() === nama.toLowerCase())) {
                    STATE.barcodes.push({ id: Date.now() + i, nama, jabatan, kontingen, barcodeUrl: null });
                    count++;
                }
            }
        });
        saveToLocalStorage(); renderMasterBarcodeList(); event.target.value = ''; alert(`${count} Data diimport.`);
    };
    reader.readAsText(file);
}

function renderMasterBarcodeList() {
    const tbody = document.getElementById('barcode-list-body');
    if (!tbody) return;
    
    if (!STATE.barcodes || STATE.barcodes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-500">Belum ada data. Silakan import CSV.</td></tr>`;
        return;
    }

    tbody.innerHTML = STATE.barcodes.map(b => {
        const jbt = (b.jabatan || '').toUpperCase();
        
        // Penyesuaian Warna Badge Berdasarkan Jabatan
        let badgeColor = 'bg-orange-900/50 text-orange-400 border-orange-700'; // Default Official
        if (jbt === 'WASIT') {
            badgeColor = 'bg-blue-900/50 text-blue-400 border-blue-700';
        } else if (jbt === 'KOORDINATOR' || jbt === 'KOORDINATOR PERTANDINGAN') {
            badgeColor = 'bg-amber-900/50 text-amber-400 border-amber-700';
        }

        let status = b.barcodeUrl 
            ? `<span class="text-green-400"><i class="fas fa-check-circle mr-1"></i>Tersambung</span>` 
            : `<span class="text-red-400"><i class="fas fa-times-circle mr-1"></i>Kosong</span>`;

        return `<tr class="border-b border-slate-800 hover:bg-slate-800/50">
            <td class="p-3 font-bold text-white">${b.nama}</td>
            <td class="p-3"><span class="px-2 py-1 rounded text-[10px] font-black border uppercase tracking-wider ${badgeColor}">${b.jabatan}</span></td>
            <td class="p-3 text-slate-400 text-xs uppercase">${b.kontingen || '-'}</td>
            <td class="p-3 text-xs font-bold">${status}</td>
            <td class="p-3 text-center whitespace-nowrap">
                <button onclick="openPairingScanner(${b.id})" class="bg-blue-900/50 border border-blue-700 hover:bg-blue-600 text-blue-300 hover:text-white p-2 w-9 h-9 rounded-lg transition-all" title="Pairing Barcode"><i class="fas fa-camera"></i></button>
                <button onclick="openAccountForm(${b.id})" class="bg-slate-700 border border-slate-600 hover:bg-yellow-600 text-slate-300 hover:text-white p-2 w-9 h-9 rounded-lg ml-1 transition-all" title="Edit Data"><i class="fas fa-edit"></i></button>
                <button onclick="deleteBarcode(${b.id})" class="bg-red-900/30 border border-red-800 hover:bg-red-600 text-red-400 hover:text-white p-2 w-9 h-9 rounded-lg ml-1 transition-all" title="Hapus Data"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
}

function deleteBarcode(id) {
    if (confirm("Hapus data ini?")) {
        STATE.barcodes = STATE.barcodes.filter(b => b.id !== id);
        saveToLocalStorage(); renderMasterBarcodeList();
    }
}

// --- KENDALI FORM AKUN (TAMBAH & EDIT) ---
function openAccountForm(id = null) {
    const modal = document.getElementById('account-form-modal');
    const title = document.getElementById('account-form-title');
    const idInput = document.getElementById('acc-id');
    const namaInput = document.getElementById('acc-nama');
    const jabatanInput = document.getElementById('acc-jabatan');
    const kontingenInput = document.getElementById('acc-kontingen');
    const shortIdInput = document.getElementById('acc-short-id');
    const courtTugasInput = document.getElementById('acc-court-tugas'); // <-- Tambahan

    if (!modal) return alert("Error: Elemen HTML untuk Modal Edit Akun tidak ditemukan!");
    modal.classList.remove('hidden');

    if (id) {
        const b = STATE.barcodes.find(x => x.id === id);
        if (b) {
            title.innerHTML = `<i class="fas fa-user-edit text-blue-500 mr-2"></i>Edit Akun`;
            idInput.value = b.id;
            namaInput.value = b.nama;
            jabatanInput.value = b.jabatan.toUpperCase() === 'WASIT' ? 'WASIT' : 'OFFICIAL';
            kontingenInput.value = b.kontingen;
            if (shortIdInput) shortIdInput.value = b.shortId || "BELUM ADA";
            if (courtTugasInput) courtTugasInput.value = b.courtTugas || "ALL"; // <-- Tambahan
        }
    } else {
        title.innerHTML = `<i class="fas fa-user-plus text-blue-500 mr-2"></i>Tambah Akun Baru`;
        idInput.value = '';
        namaInput.value = '';
        jabatanInput.value = 'OFFICIAL';
        kontingenInput.value = '';
        if (shortIdInput) shortIdInput.value = "DIBUAT OTOMATIS";
        if (courtTugasInput) courtTugasInput.value = "ALL"; // <-- Tambahan
    }
    handleJabatanFormChange();
}

function closeAccountForm() {
    document.getElementById('account-form-modal').classList.add('hidden');
}

function handleJabatanFormChange() {
    const jabatan = document.getElementById('acc-jabatan').value;
    const kontingenInput = document.getElementById('acc-kontingen');

    if (jabatan === 'WASIT' || jabatan === 'KOORDINATOR') {
        kontingenInput.value = '-';
        kontingenInput.readOnly = true;
        kontingenInput.classList.add('opacity-50', 'bg-slate-800', 'cursor-not-allowed');
    } else {
        if (kontingenInput.value === '-') kontingenInput.value = '';
        kontingenInput.readOnly = false;
        kontingenInput.classList.remove('opacity-50', 'bg-slate-800', 'cursor-not-allowed');
    }
}

function saveAccountForm(event) {
    event.preventDefault();
    const id = document.getElementById('acc-id').value;
    const nama = document.getElementById('acc-nama').value.trim();
    const jabatan = document.getElementById('acc-jabatan').value;
    const kontingen = document.getElementById('acc-kontingen').value.trim() || '-';
    const courtTugas = document.getElementById('acc-court-tugas').value || 'ALL'; // <-- Tambahan

    if (!nama) return;

    if (id) {
        const idx = STATE.barcodes.findIndex(b => b.id == id);
        if (idx > -1) {
            if (STATE.barcodes.some(b => b.id != id && b.nama.toLowerCase() === nama.toLowerCase())) {
                return alert("Gagal: Nama ini sudah ada di database!");
            }
            STATE.barcodes[idx].nama = nama;
            STATE.barcodes[idx].jabatan = jabatan;
            STATE.barcodes[idx].kontingen = kontingen;
            STATE.barcodes[idx].courtTugas = courtTugas; // <-- Tambahan

            if (!STATE.barcodes[idx].shortId) {
                let prefix = jabatan === 'WASIT' ? 'W' : 'O';
                STATE.barcodes[idx].shortId = prefix + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
            }
        }
    } else {
        if (STATE.barcodes.some(b => b.nama.toLowerCase() === nama.toLowerCase())) {
            return alert("Gagal: Nama ini sudah ada di database!");
        }

        let prefix = jabatan === 'WASIT' ? 'W' : 'O';
        let newShortId = prefix + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

        STATE.barcodes.push({
            id: Date.now(),
            nama: nama,
            jabatan: jabatan,
            kontingen: kontingen,
            barcodeUrl: null,
            shortId: newShortId,
            courtTugas: courtTugas // <-- Tambahan
        });
    }

    saveToLocalStorage();
    renderMasterBarcodeList();
    closeAccountForm();
}

let pairingScannerRef = null;
let SCANNER_TARGET_ID = null;

function openPairingScanner(id) {
    SCANNER_TARGET_ID = id;
    let b = STATE.barcodes.find(x => x.id === id);
    if (!b) return;

    document.getElementById('pairing-target-name').innerText = b.nama;
    document.getElementById('pairing-target-role').innerText = b.jabatan;
    document.getElementById('pairing-radar-modal').classList.remove('hidden');

    // PENGAMAN: Hanya nyalakan telinga Firebase jika Firebase hidup
    if (database) {
        pairingScannerRef = database.ref(`scanner_inbox/admin`);
        pairingScannerRef.on('child_added', (snapshot) => {
            const data = snapshot.val();
            if (data && data.url) {
                processPairingUrl(data.url, snapshot.key);
            }
        });
    }
}

function processPairingUrl(url, snapKey) {
    let idx = STATE.barcodes.findIndex(b => b.id === SCANNER_TARGET_ID);
    if (idx > -1) {
        let exist = STATE.barcodes.find(b => b.barcodeUrl === url && b.id !== SCANNER_TARGET_ID);

        if (exist) {
            // PENGAMAN LOKAL
            if (database) {
                database.ref(`scanner_feedback/admin`).set({ id: snapKey, status: 'FAILED', timestamp: Date.now() });
                database.ref(`scanner_inbox/admin/${snapKey}`).remove();
            }
            alert(`❌ GAGAL! Barcode ini sudah dipakai oleh: ${exist.nama}`);
            return false;
        }

        STATE.barcodes[idx].barcodeUrl = url;
        saveToLocalStorage(); // Akan trigger update SQLite
        renderMasterBarcodeList();

        // PENGAMAN LOKAL
        if (database) {
            database.ref(`scanner_feedback/admin`).set({ id: snapKey, status: 'SUCCESS', timestamp: Date.now() });
            database.ref(`scanner_inbox/admin/${snapKey}`).remove();
        }

        closePairingRadarModal();
        return true;
    }
}

function closePairingRadarModal() {
    document.getElementById('pairing-radar-modal').classList.add('hidden');
    if (pairingScannerRef) {
        pairingScannerRef.off(); // Matikan sensor agar tidak bocor
        pairingScannerRef = null;
    }
}

// 2. MESIN RADAR VERIFIKASI (MEJA PANITERA / COURT)
let mobileScannerRef = null;

function openVerificationModal() {
    if (!currentRandoriMatchId) return alert("Pilih partai Randori terlebih dahulu!");

    let match = STATE.matches.find(m => m.id === currentRandoriMatchId);
    if (!match) return;

    let pMrh = STATE.participants.find(p => p.id === match.merahId);
    let pPth = STATE.participants.find(p => p.id === match.putihId);
    let displayNum = match.matchNum % 50 === 0 ? 50 : match.matchNum % 50;

    document.getElementById('v-match-identity').innerHTML = `
        <div class="text-[10px] text-slate-400 font-bold uppercase tracking-widest border-b border-slate-700 pb-1 mb-1">Partai G-${displayNum} &bull; Pool ${match.pool} &bull; ${match.babak}</div>
        <div class="text-[11px] font-black text-blue-400 mb-2 leading-tight">${match.kategori}</div>
        <div class="flex justify-between items-center text-xs font-bold bg-slate-950 p-2 rounded-lg border border-slate-800">
            <span class="text-red-400 truncate w-[45%]">${pMrh ? pMrh.nama.split(',')[0] : '-'}</span>
            <span class="text-slate-600 text-[9px] italic">VS</span>
            <span class="text-white truncate w-[45%] text-right">${pPth ? pPth.nama.split(',')[0] : '-'}</span>
        </div>
    `;

    let badgeCourt = document.getElementById('ui-court-badge');
    if (badgeCourt) badgeCourt.innerText = String(DEVICE_ROLE).replace('_', ' ').toUpperCase();

    refreshVerifikatorUI(match);
    document.getElementById('verification-modal').classList.remove('hidden');

    if (DEVICE_ROLE !== 'admin') {
        // PENGAMAN: Hanya nyalakan telinga Firebase jika Firebase hidup
        if (database) {
            mobileScannerRef = database.ref(`scanner_inbox/${DEVICE_ROLE}`);
            mobileScannerRef.on('child_added', (snapshot) => {
                const data = snapshot.val();
                if (data && data.url) {
                    let isSuccess = processVerificationUrl(data.url);
                    database.ref(`scanner_feedback/${DEVICE_ROLE}`).set({
                        id: snapshot.key, status: isSuccess ? 'SUCCESS' : 'FAILED', timestamp: Date.now()
                    });
                    snapshot.ref.remove();
                }
            });
        }
    } else {
        alert("Peringatan: Perangkat ini di-set sebagai 'Admin Utama'. Mode Radar Mobile hanya bekerja jika Anda mengatur peran perangkat menjadi Court 1/2/3.");
    }
}

function closeVerificationModal() {
    document.getElementById('verification-modal').classList.add('hidden');
    if (mobileScannerRef) {
        mobileScannerRef.off();
        mobileScannerRef = null;
    }
}

// ==============================================================
// 3. LOGIKA SMART ASSIGN & REGEX KONTINGEN (REVISI PERANG SAUDARA)
// ==============================================================

// FUNGSI PENCUCI KE NAMA INDUK (Base Name)
const getIndukKontingen = (str) => {
    if (!str || str === '-') return '';

    let cleaned = String(str).toUpperCase().trim();

    // 1. Standarisasi Wilayah
    cleaned = cleaned.replace(/\b(KABUPATEN|KAB\.|KAB)\b/g, 'KAB');
    cleaned = cleaned.replace(/\b(KOTA|KOT\.|KOT)\b/g, 'KOTA');
    cleaned = cleaned.replace(/\b(PROVINSI|PROV\.|PROV)\b/g, 'PROV');
    cleaned = cleaned.replace(/\b(UNIVERSITAS|UNIV\.|UNIV|INSTITUT)\b/g, 'UNIV');

    // 2. Potong Ekor Regu (A/B/1/2 dll)
    cleaned = cleaned.replace(/\s*\(([a-zA-Z]|[IVX]{1,3}|\d{1,2})\)$/i, ' ');
    cleaned = cleaned.replace(/\s+[A-Z]$/i, ' ');

    // 3. Kompresi Total (Hilangkan spasi & simbol agar presisi 100%)
    return cleaned.replace(/[^A-Z0-9]/g, '');
};

// HELPER KECERDASAN: Menentukan Kursi Official
const smartAssignOfficial = (match, user) => {
    let pMrh = STATE.participants.find(p => p.id === match.merahId);
    let pPth = STATE.participants.find(p => p.id === match.putihId);

    let idUser = getIndukKontingen(user.kontingen);
    let mrhInduk = pMrh ? getIndukKontingen(pMrh.kontingen) : '';
    let pthInduk = pPth ? getIndukKontingen(pPth.kontingen) : '';

    // TAHAP 2: Deteksi Perang Saudara
    let isPerangSaudara = (mrhInduk === pthInduk && mrhInduk !== '');

    if (isPerangSaudara) {
        // TAHAP 3: PROTOKOL KURSI KOSONG
        if (idUser === mrhInduk) {
            if (!match.verifikator.officialMerah) {
                match.verifikator.officialMerah = user.nama;
                return true;
            } else if (!match.verifikator.officialPutih) {
                match.verifikator.officialPutih = user.nama;
                return true;
            } else {
                return "FULL"; // Penolakan karena sudah diisi 2 orang
            }
        }
    } else {
        // PERTANDINGAN NORMAL
        if (idUser === mrhInduk) {
            match.verifikator.officialMerah = user.nama;
            return true;
        } else if (idUser === pthInduk) {
            match.verifikator.officialPutih = user.nama;
            return true;
        }
    }

    return false; // Gagal: Pelatih bukan dari kontingen yang bertanding
};

function processVerificationUrl(url) {
    let user = STATE.barcodes.find(b => b.barcodeUrl === url);
    if (!user) return false;

    let match = STATE.matches.find(m => m.id === currentRandoriMatchId);
    if (!match) return false;
    if (!match.verifikator) match.verifikator = { wasit: null, officialMerah: null, officialPutih: null };

    let jabatan = user.jabatan.toUpperCase();

    if (jabatan === 'WASIT') {
        match.verifikator.wasit = user.nama;
    } else {
        let assignResult = smartAssignOfficial(match, user);
        if (assignResult === "FULL" || assignResult === false) return false;
    }

    let mIdx = STATE.matches.findIndex(m => m.id === currentRandoriMatchId);

    // Simpan ke State Utama
    STATE.matches[mIdx].verifikator = match.verifikator;

    // PENGAMAN LOKAL: Hanya kirim ke Firebase jika hidup
    if (database) {
        database.ref(`turnamen_data/matches/${mIdx}/verifikator`).set(match.verifikator);
    }

    refreshVerifikatorUI(match);
    return true;
}

function handleScanSuccess(url) {
    if (SCANNER_MODE === 'pairing') {
        let idx = STATE.barcodes.findIndex(b => b.id === SCANNER_TARGET_ID);
        if (idx > -1) {
            let exist = STATE.barcodes.find(b => b.barcodeUrl === url && b.id !== SCANNER_TARGET_ID);
            if (exist) return alert(`Gagal! Barcode ini sudah terdaftar milik ${exist.nama}`);
            STATE.barcodes[idx].barcodeUrl = url;
            saveToLocalStorage(); renderMasterBarcodeList(); closeScannerModal();
            alert(`✅ SUKSES! Barcode berhasil dikaitkan ke: ${STATE.barcodes[idx].nama}`);
        }
    } else if (SCANNER_MODE === 'verify') {
        let user = STATE.barcodes.find(b => b.barcodeUrl === url);
        if (!user) {
            alert("❌ BARCODE DITOLAK: Tidak terdaftar di sistem.");
            if (html5QrCodeVerify && html5QrCodeVerify.getState() === Html5QrcodeScannerState.PAUSED) html5QrCodeVerify.resume();
            return;
        }

        let match = STATE.matches.find(m => m.id === currentRandoriMatchId);
        if (!match) return;
        if (!match.verifikator) match.verifikator = { wasit: null, officialMerah: null, officialPutih: null };

        let jabatan = user.jabatan.toUpperCase();

        if (jabatan === 'WASIT') {
            match.verifikator.wasit = user.nama;
        } else {
            // Tembakkan ke Mesin Kecerdasan dengan Feedback Layar
            let assignResult = smartAssignOfficial(match, user);

            if (assignResult === "FULL") {
                alert(`❌ DITOLAK: Kursi Official untuk kontingen ini sudah penuh!`);
                if (html5QrCodeVerify && html5QrCodeVerify.getState() === Html5QrcodeScannerState.PAUSED) html5QrCodeVerify.resume();
                return;
            } else if (assignResult === false) {
                alert(`❌ DITOLAK: ${user.nama} adalah Official dari ${user.kontingen}, bukan bagian dari partai ini.`);
                if (html5QrCodeVerify && html5QrCodeVerify.getState() === Html5QrcodeScannerState.PAUSED) html5QrCodeVerify.resume();
                return;
            }
        }

        let mIdx = STATE.matches.findIndex(m => m.id === currentRandoriMatchId);
        database.ref(`turnamen_data/matches/${mIdx}/verifikator`).set(match.verifikator);
        refreshVerifikatorUI(match);

        setTimeout(() => {
            if (html5QrCodeVerify && html5QrCodeVerify.getState() === Html5QrcodeScannerState.PAUSED) {
                html5QrCodeVerify.resume();
            }
        }, 800);
    }
}

// ==============================================================
// LOGIKA KHUSUS SETUP QR SCANNER ADMIN (PAIRING MODE)
// ==============================================================
async function openAdminQrSetupModal() {
    // 1. Bersihkan QR Lama dan tampilkan modal (Kita pakai ulang modal Operator)
    document.getElementById("qr-code-canvas").innerHTML = "";
    document.getElementById('qr-operator-modal').classList.remove('hidden');

    // 2. Tarik IP dinamis dari LAN Laptop
    let serverIp = "127.0.0.1";
    try {
        const response = await fetch('/api/server-ip');
        const data = await response.json();
        serverIp = data.ip;
    } catch (error) {
        console.error("Gagal mendeteksi IP LAN:", error);
    }

    // 3. RAKIT PAYLOAD JSON KHUSUS ADMIN
    // Perhatikan court diatur permanen ke 'admin'
    const payloadData = {
        court: 'admin',
        mode: SYSTEM_MODE.toLowerCase(),
        ip: serverIp
    };

    const jsonString = JSON.stringify(payloadData);

    // 4. Gambar QR Code JSON
    new QRCode(document.getElementById("qr-code-canvas"), {
        text: jsonString,
        width: 190,
        height: 190,
        colorDark: "#0f172a",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.L
    });

    // 5. Update Teks Judul di dalam Modal
    document.getElementById('qr-target-court').innerText = "ADMIN (PAIRING)";
}

function refreshVerifikatorUI(match) {
    if (!match) return;
    let vf = match.verifikator || { wasit: null, officialMerah: null, officialPutih: null };

    // 1. BLOK WASIT (BIRU)
    let wBlock = document.getElementById('v-block-wasit');
    let wName = document.getElementById('v-name-wasit');
    if (wBlock && wName) {
        if (vf.wasit) {
            wBlock.className = "bg-blue-600 border-2 border-blue-400 rounded-xl p-4 flex flex-col items-center justify-center text-center transition-all duration-300 min-h-[90px] shadow-[0_0_15px_rgba(37,99,235,0.4)]";
            wBlock.querySelector('span:first-child').className = "text-[10px] font-black uppercase tracking-widest text-blue-200 mb-1";
            wName.className = "font-black text-white text-base tracking-wide";
            wName.innerHTML = `<i class="fas fa-check-circle mr-1"></i> ${vf.wasit}`;
        } else {
            wBlock.className = "bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col items-center justify-center text-center transition-all duration-500 min-h-[90px]";
            wBlock.querySelector('span:first-child').className = "text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1";
            wName.className = "font-bold text-slate-600 text-sm";
            wName.innerText = "Menunggu Scan...";
        }
    }

    // 2. BLOK MERAH (MERAH SOLID)
    let mBlock = document.getElementById('v-block-merah');
    let mName = document.getElementById('v-name-merah');
    if (mBlock && mName) {
        if (vf.officialMerah) {
            mBlock.className = "bg-red-600 border-2 border-red-400 rounded-xl p-4 flex flex-col items-center justify-center text-center transition-all duration-300 min-h-[90px] shadow-[0_0_15px_rgba(220,38,38,0.4)]";
            mBlock.querySelector('span:first-child').className = "text-[10px] font-black uppercase tracking-widest text-red-200 mb-1";
            mName.className = "font-black text-white text-base tracking-wide";
            mName.innerHTML = `<i class="fas fa-check-circle mr-1"></i> ${vf.officialMerah}`;
        } else {
            mBlock.className = "bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col items-center justify-center text-center transition-all duration-500 min-h-[90px]";
            mBlock.querySelector('span:first-child').className = "text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1";
            mName.className = "font-bold text-slate-600 text-sm";
            mName.innerText = "Menunggu Scan...";
        }
    }

    // 3. BLOK PUTIH (PUTIH BERSIH)
    let pBlock = document.getElementById('v-block-putih');
    let pName = document.getElementById('v-name-putih');
    if (pBlock && pName) {
        if (vf.officialPutih) {
            pBlock.className = "bg-white border-2 border-slate-300 rounded-xl p-4 flex flex-col items-center justify-center text-center transition-all duration-300 min-h-[90px] shadow-[0_0_15px_rgba(255,255,255,0.4)]";
            pBlock.querySelector('span:first-child').className = "text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1";
            // Kontras Hitam karena bg Putih
            pName.className = "font-black text-slate-900 text-base tracking-wide";
            pName.innerHTML = `<i class="fas fa-check-circle text-green-500 mr-1"></i> ${vf.officialPutih}`;
        } else {
            pBlock.className = "bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col items-center justify-center text-center transition-all duration-500 min-h-[90px]";
            pBlock.querySelector('span:first-child').className = "text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1";
            pName.className = "font-bold text-slate-600 text-sm";
            pName.innerText = "Menunggu Scan...";
        }
    }
}

// SUNTIKAN KE FUNGSI loadRandoriMatch
const originalLoadRandoriMatch = loadRandoriMatch;
loadRandoriMatch = function () {
    originalLoadRandoriMatch(); // Panggil fungsi aslinya

    // Logika tambahan untuk memunculkan Panel Verifikator
    let vfPanel = document.getElementById('panel-verifikator');
    if (vfPanel) {
        if (STATE.settings && STATE.settings.enableVerifikator) {
            vfPanel.classList.remove('hidden');
            let match = STATE.matches.find(m => m.id === currentRandoriMatchId);
            if (match) refreshVerifikatorUI(match);
        } else {
            vfPanel.classList.add('hidden');
        }
    }
};

// --- SISTEM SMART URL & QR GENERATOR ---

// =========================================================
// ⚙️ PENGATURAN URL TERMINAL WASIT & SCANNER DI TAB ADMIN
// =========================================================
function saveWasitUrl() {
    const inputEl = document.getElementById('setting-wasit-url');
    if (!inputEl) return;

    const val = inputEl.value.trim();
    if (!STATE.settings) STATE.settings = {};

    STATE.settings.wasitUrl = val;
    STATE.settings.wasitBaseUrl = val;
    localStorage.setItem('mass_wasit_url', val);

    saveToLocalStorage();
    alert("✅ URL Aplikasi Wasit berhasil disimpan:\n" + (val || "(Default Lokal)"));
}

function saveScannerUrl() {
    const inputEl = document.getElementById('setting-scanner-url');
    if (!inputEl) return;

    const val = inputEl.value.trim();
    if (!STATE.settings) STATE.settings = {};

    STATE.settings.scannerUrl = val;
    localStorage.setItem('mass_scanner_url', val);

    saveToLocalStorage();
    alert("✅ URL Mobile Scanner berhasil disimpan:\n" + (val || "(Default Lokal)"));
}

const originalSwitchTab = switchTab;
switchTab = function (targetTab) {
    originalSwitchTab(targetTab);
    if (targetTab === 'admin') {
        let urlScannerEl = document.getElementById('setting-scanner-url');
        if (urlScannerEl) {
            urlScannerEl.value = (STATE.settings && (STATE.settings.scannerUrl || STATE.settings.scannerBaseUrl)) 
                ? (STATE.settings.scannerUrl || STATE.settings.scannerBaseUrl) 
                : (localStorage.getItem('mass_scanner_url') || "");
        }

        let urlWasitEl = document.getElementById('setting-wasit-url');
        if (urlWasitEl) {
            urlWasitEl.value = (STATE.settings && (STATE.settings.wasitUrl || STATE.settings.wasitBaseUrl)) 
                ? (STATE.settings.wasitUrl || STATE.settings.wasitBaseUrl) 
                : (localStorage.getItem('mass_wasit_url') || "");
        }
    }
};

// Fungsi Buka Pop-up & Gambar QR Setup (Berisi JSON)
async function openQrOperatorModal() {
    if (DEVICE_ROLE === 'admin') {
        alert("Perangkat Anda berstatus 'Admin'. QR Code ini dirancang khusus untuk memanggil Scanner Court (Court 1/2/3).");
        return;
    }

    // 1. Bersihkan QR Lama dan tampilkan modal
    document.getElementById("qr-code-canvas").innerHTML = "";
    document.getElementById('qr-operator-modal').classList.remove('hidden');

    // 2. Tarik IP dinamis dari Node.js (Metode Async)
    let serverIp = "127.0.0.1";
    try {
        const response = await fetch('/api/server-ip');
        const data = await response.json();
        serverIp = data.ip;
    } catch (error) {
        console.error("Gagal mendeteksi IP LAN:", error);
    }

    // 3. RAKIT PAYLOAD JSON MURNI
    const payloadData = {
        court: DEVICE_ROLE,
        mode: SYSTEM_MODE.toLowerCase(),
        ip: serverIp
    };

    // Ubah Objek JS menjadi String JSON baku
    const jsonString = JSON.stringify(payloadData);

    // 4. Gambar QR Code Baru dengan isi JSON
    new QRCode(document.getElementById("qr-code-canvas"), {
        text: jsonString,
        width: 190, // Ukuran pas untuk kotak putih
        height: 190,
        colorDark: "#0f172a", // Hitam kebiruan elegan (Slate-950)
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.L // Level akurasi rendah (Cukup karena isi JSON pendek)
    });

    // 5. Update Teks UI
    document.getElementById('qr-target-court').innerText = DEVICE_ROLE.replace('_', ' ').toUpperCase();
}

function closeQrOperatorModal() {
    document.getElementById('qr-operator-modal').classList.add('hidden');
}

// ==============================================================
// 📲 MODAL SCANNER ADAPTIF (WEB LINK CLOUD VS DOWNLOAD APK LAN)
// ==============================================================
async function bukaModalDownloadAPK() {
    closeQrOperatorModal();

    const modal = document.getElementById('apk-download-modal');
    const canvas = document.getElementById("qr-apk-canvas");
    const titleEl = document.getElementById("modal-scanner-title");
    const stepTitleEl = document.getElementById("modal-scanner-step-title");
    const stepListEl = document.getElementById("modal-scanner-step-list");

    if (!modal || !canvas) return;

    canvas.innerHTML = "";
    modal.classList.remove('hidden');

    const safeCourt = typeof DEVICE_ROLE !== 'undefined' && DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';
    const isCloudMode = SYSTEM_MODE.toLowerCase() === 'online' || 
                        SYSTEM_MODE.toLowerCase() === 'firebase' || 
                        window.location.hostname.includes('github.io') || 
                        window.location.hostname.includes('netlify.app');

    // ----------------------------------------------------------
    // A. JALUR ONLINE / FIREBASE CLOUD (BUKA WEB SCANNER LANGSUNG)
    // ----------------------------------------------------------
    if (isCloudMode) {
        // Tarik URL Mobile Scanner dari Form Admin / Settings
        const inputScannerUrl = document.getElementById('setting-scanner-url') ? document.getElementById('setting-scanner-url').value.trim() : "";
        const savedScannerUrl = (STATE.settings && (STATE.settings.scannerUrl || STATE.settings.scannerBaseUrl)) ? (STATE.settings.scannerUrl || STATE.settings.scannerBaseUrl).trim() : "";
        const localSavedScannerUrl = (localStorage.getItem('mass_scanner_url') || "").trim();

        let scannerBaseUrl = inputScannerUrl || savedScannerUrl || localSavedScannerUrl || "https://portable-scanner.netlify.app";

        if (scannerBaseUrl.endsWith('/')) scannerBaseUrl = scannerBaseUrl.slice(0, -1);
        const separator = scannerBaseUrl.includes('?') ? '&' : '?';
        const fullWebScannerUrl = `${scannerBaseUrl}${separator}court=${safeCourt}`;

        // Perbarui Tampilan UI ke Mode Web Scanner
        if (titleEl) {
            titleEl.className = "text-sm font-black text-cyan-400 tracking-widest uppercase mb-2 border-b border-slate-700 pb-3 w-full text-center";
            titleEl.innerHTML = `<i class="fas fa-qrcode mr-2"></i>LINK WEB SCANNER (${safeCourt.replace('_', ' ').toUpperCase()})`;
        }
        if (stepTitleEl) {
            stepTitleEl.innerHTML = `<i class="fas fa-mobile-alt text-cyan-400 mr-2"></i>Petunjuk Penggunaan Web Scanner:`;
        }
        if (stepListEl) {
            stepListEl.innerHTML = `
                <li>Buka kamera bawaan HP atau Google Lens, lalu arahkan ke QR di atas.</li>
                <li>Ketuk link tautan untuk membuka <b>Web Scanner</b> di browser HP.</li>
                <li>Pilih <b>'Allow / Izinkan'</b> saat browser meminta izin kamera.</li>
                <li>Scanner langsung aktif dan terhubung ke <b>${safeCourt.replace('_', ' ').toUpperCase()}</b> tanpa perlu menginstal APK!</li>
            `;
        }

        // Gambar QR Code Web Link
        new QRCode(canvas, {
            text: fullWebScannerUrl,
            width: 190,
            height: 190,
            colorDark: "#0f172a",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.L
        });
        return;
    }

    // ----------------------------------------------------------
    // B. JALUR LOKAL LAN & HYBRID (DOWNLOAD FILE APK SERVER NODE.JS)
    // ----------------------------------------------------------
    let serverIp = "127.0.0.1";
    let port = window.location.port ? ':' + window.location.port : '';

    try {
        const response = await fetch('/api/server-ip');
        if (response.ok) {
            const data = await response.json();
            serverIp = data.ip;
        }
    } catch (error) {
        console.warn("Menggunakan IP host saat ini:", window.location.hostname);
        serverIp = window.location.hostname || "127.0.0.1";
    }

    const apkUrl = `http://${serverIp}${port}/downloads/scanner-masskempo.apk`;

    // Perbarui Tampilan UI ke Mode Download APK
    if (titleEl) {
        titleEl.className = "text-sm font-black text-green-400 tracking-widest uppercase mb-2 border-b border-slate-700 pb-3 w-full text-center";
        titleEl.innerHTML = `<i class="fas fa-download mr-2"></i>DOWNLOAD APK SCANNER (LAN)`;
    }
    if (stepTitleEl) {
        stepTitleEl.innerHTML = `<i class="fas fa-list-ol text-blue-400 mr-2"></i>Prosedur Instalasi APK:`;
    }
    if (stepListEl) {
        stepListEl.innerHTML = `
            <li>Buka kamera bawaan HP (atau Google Lens) dan scan QR di atas.</li>
            <li>Ketuk link yang muncul untuk mengunduh (download) file APK.</li>
            <li>Buka file yang terunduh dan tekan <b>'Install'</b>.</li>
            <li>Bila muncul peringatan keamanan, pilih <b>'Settings/Pengaturan'</b> &rarr; aktifkan <b>'Allow from this source'</b> (Izinkan dari sumber ini).</li>
        `;
    }

    // Gambar QR Code Link Download APK
    new QRCode(canvas, {
        text: apkUrl,
        width: 190,
        height: 190,
        colorDark: "#166534",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
    });
}

function tutupModalDownloadAPK() {
    const modal = document.getElementById('apk-download-modal');
    if (modal) modal.classList.add('hidden');
}

// =========================================================
// SAKLAR KONEKSI WASIT DIGITAL (HEMAT KUOTA & SATU PINTU)
// =========================================================
function toggleWasitMode() {
    isWasitDigitalMode = !isWasitDigitalMode;
    const btn = document.getElementById('btnTembakWasit');
    const safeCourtId = typeof DEVICE_ROLE !== 'undefined' && DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';

    if (btn) {
        if (isWasitDigitalMode) {
            btn.className = "w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3 px-4 rounded-xl shadow-lg mt-3 transition-all border border-emerald-400";
            btn.innerHTML = '<i class="fas fa-broadcast-tower mr-2 animate-pulse"></i> KONEKSI WASIT AKTIF (KLIK MATIKAN)';
            tembakDataKeFirebase();
        } else {
            btn.className = "w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 px-4 rounded-xl shadow-md mt-3 transition-all border border-slate-600";
            btn.innerHTML = '<i class="fas fa-power-off mr-2"></i> AKTIFKAN KONEKSI HP WASIT';

            // 🔥 Kirim status standby murni (layar HP wasit terkunci, posisi tetap aman)
            const payloadStandby = { status: 'standby' };
            if (database) {
                database.ref(`live_embu/${safeCourtId}`).update(payloadStandby).catch(e => console.warn(e));
            }
            if (typeof localSocket !== 'undefined' && localSocket) {
                localSocket.emit('broadcast_to_tv', {
                    channel: 'lokal_panitera',
                    court: safeCourtId,
                    payload: payloadStandby
                });
            }
        }
    }
}

function tendangSemuaWasit() {
    if (confirm("Tendang semua wasit ke posisi Non-Aktif / Cadangan?\nMereka harus memilih posisi wasit kembali.")) {
        const safeCourtId = DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';

        // 👇 SUNTIKAN JARINGAN LOKAL 👇
        if (typeof localSocket !== 'undefined' && localSocket !== null && localSocket.connected) {
            localSocket.emit('broadcast_to_tv', {
                channel: 'lokal_panitera', court: safeCourtId, payload: { action: 'logout_posisi' }
            });
        }

        if (database) {
            database.ref(`live_embu/${safeCourtId}/command`).set({ action: 'logout_posisi', timestamp: Date.now() });
        }
        alert("Sinyal tendang berhasil dikirim ke seluruh HP Wasit di court ini.");
    }
}

// =========================================================
// SUNTIKAN: GENERATOR DATA ANTREAN PLAYLIST UNTUK HP WASIT
// =========================================================
function getPlaylistAntreanPayload() {
    // 1. JIKA ACTIVE_PLAYLIST SEDANG BERJALAN
    if (ACTIVE_PLAYLIST.isActive && ACTIVE_PLAYLIST.block) {
        let blk = ACTIVE_PLAYLIST.block;
        let items = [];

        // KASUS A: MATCH SYSTEM (EMBU H2H / DOUBLE ELIMINATION / RANDORI)
        if (blk.matchNums && blk.matchNums.length > 0) {
            blk.matchNums.forEach(mNum => {
                let m = STATE.matches.find(x =>
                    (normStr(x.kategori) === normStr(blk.catNameReal) || normStr(x.kategori) === normStr(blk.title)) &&
                    x.matchNum === mNum &&
                    (blk.pool ? x.pool === blk.pool : true)
                );
                if (m) {
                    let pMrh = STATE.participants.find(p => p.id === m.merahId);
                    let pPth = STATE.participants.find(p => p.id === m.putihId);
                    let displayNum = m.matchNum % 50 === 0 ? 50 : m.matchNum % 50;

                    items.push({
                        matchId: m.id,
                        label: `G-${displayNum}`,
                        babak: m.babak,
                        merahId: m.merahId,
                        merahNama: pMrh ? pMrh.nama : "Menunggu...",
                        merahKont: pMrh ? pMrh.kontingen : "-",
                        putihId: m.putihId,
                        putihNama: pPth ? pPth.nama : "Menunggu...",
                        putihKont: pPth ? pPth.kontingen : "-",
                        isDone: (m.status === 'done' || m.status === 'auto-win')
                    });
                }
            });

            return {
                type: 'h2h',
                title: blk.title || "-",
                subtitle: blk.subtitle ? `BLOK SAAT INI • ${blk.subtitle}` : "BLOK SAAT INI",
                items: items
            };

            // KASUS B: EMBU BAKU / FESTIVAL
        } else if (blk.embuTrackers) {
            let babakType = blk.babak || 'b1';
            let isEksibisi = blk.isEksibisi === true;

            blk.embuTrackers.forEach(t => {
                let p = STATE.participants.find(x =>
                    x.kategori === blk.catNameReal &&
                    ((babakType === 'final' && !isEksibisi) ? x.urutFinal === t.label : (babakType === 'b2' ? x.urutB2 === t.label : x.urut === t.label)) &&
                    (blk.pool ? x.pool === blk.pool : true)
                );

                if (p) {
                    let isDone = false;
                    if (babakType === 'b1' && p.scores.b1.final > 0) isDone = true;
                    if (babakType === 'b2' && p.scores.b2.final > 0) isDone = true;
                    if (babakType === 'final' && !isEksibisi && p.scores.b2.final > 0) isDone = true;

                    items.push({
                        id: p.id,
                        label: `No. ${t.label}`,
                        nama: p.nama,
                        kontingen: p.kontingen,
                        isDone: isDone
                    });
                } else {
                    items.push({
                        id: null,
                        label: `No. ${t.label}`,
                        nama: "Menunggu Atlet...",
                        kontingen: "-",
                        isDone: false
                    });
                }
            });

            return {
                type: 'baku',
                title: blk.title || "-",
                subtitle: blk.subtitle ? `BLOK SAAT INI • ${blk.subtitle}` : "BLOK SAAT INI",
                items: items
            };
        }
    }

    // 2. JIKA PENJURIAN MANUAL (NON-PLAYLIST)
    const catSelect = document.getElementById('select-kategori');
    const catName = catSelect ? catSelect.value : '';
    const catObj = STATE.categories.find(c => c.name === catName);
    if (!catObj) return null;

    let isH2H = (catObj.discipline === 'embu' && STATE.settings && STATE.settings.embuFormat === 'h2h') || catObj.discipline === 'randori';

    if (isH2H) {
        let matches = STATE.matches.filter(m => m.kategori === catName && m.merahId != null && m.putihId != null && m.merahId !== -1 && m.putihId !== -1);
        let items = matches.map(m => {
            let pMrh = STATE.participants.find(p => p.id === m.merahId);
            let pPth = STATE.participants.find(p => p.id === m.putihId);
            let displayNum = m.matchNum % 50 === 0 ? 50 : m.matchNum % 50;
            return {
                matchId: m.id,
                label: `G-${displayNum}`,
                babak: m.babak,
                merahId: m.merahId,
                merahNama: pMrh ? pMrh.nama : "-",
                merahKont: pMrh ? pMrh.kontingen : "-",
                putihId: m.putihId,
                putihNama: pPth ? pPth.nama : "-",
                putihKont: pPth ? pPth.kontingen : "-",
                isDone: (m.status === 'done' || m.status === 'auto-win')
            };
        });
        return {
            type: 'h2h',
            title: catName,
            subtitle: "SEMUA PARTAI",
            items: items
        };
    } else {
        let listCat = STATE.participants.filter(p => p.kategori === catName && p.urut > 0).sort((a, b) => a.urut - b.urut);
        let items = listCat.map(p => ({
            id: p.id,
            label: `No. ${p.urut}`,
            nama: p.nama,
            kontingen: p.kontingen,
            isDone: (p.scores && p.scores.b1 && p.scores.b1.final > 0)
        }));
        return {
            type: 'baku',
            title: catName,
            subtitle: "URUTAN TAMPIL",
            items: items
        };
    }
}

// =========================================================
// FUNGSI TEMBAK DATA KE FIREBASE / HP WASIT (DILENGKAPI ANTREAN)
// =========================================================
function tembakDataKeFirebase() {
    const val = document.getElementById('select-peserta').value;
    if (!val) return;
    const safeCourtId = typeof DEVICE_ROLE !== 'undefined' && DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';
    const currentLocalJudges = parseInt(localStorage.getItem('local_judges')) || 5;

    let payload = null;
    let playlistAntrean = typeof getPlaylistAntreanPayload === "function" ? getPlaylistAntreanPayload() : null;

    if (val.startsWith('h2h-match-')) {
        const parts = val.split('-');
        const matchId = parseInt(parts[2]);
        const corner = parts[3];
        const pId = parseInt(parts[4]);

        const m = STATE.matches.find(x => x.id === matchId);
        const p = STATE.participants.find(x => x.id === pId);
        if (!m || !p) return;

        let wazaList = [];
        if (p.idFirestore) {
            try {
                let cacheWaza = JSON.parse(localStorage.getItem('CACHE_WAZA_EMBU')) || {};
                if (cacheWaza[p.idFirestore]) wazaList = cacheWaza[p.idFirestore];
            } catch (e) { }
        }

        let displayNum = m.matchNum % 50 === 0 ? 50 : m.matchNum % 50;

        payload = {
            status: 'aktif',
            partai_id: val,
            sistem: 'double_elimination',
            kategori: p.kategori,
            game: displayNum,
            babak: m.babak,
            pita: corner,
            kontingen: p.kontingen,
            nama: p.nama,
            waza: wazaList,
            numJudges: currentLocalJudges,
            playlist_antrean: playlistAntrean
        };
    } else if (val.includes('|')) {
        const [pIdStr, babak] = val.split('|');
        const pId = parseInt(pIdStr);
        const p = STATE.participants.find(x => x.id === pId);
        if (!p) return;

        let wazaList = [];
        if (p.idFirestore) {
            try {
                let cacheWaza = JSON.parse(localStorage.getItem('CACHE_WAZA_EMBU')) || {};
                if (cacheWaza[p.idFirestore]) wazaList = cacheWaza[p.idFirestore];
            } catch (e) { }
        }

        let noUrut = p.urut;
        if (babak === 'b2') noUrut = p.urutB2 || p.urut;
        if (p.isFinalist) noUrut = p.urutFinal || p.urut;

        payload = {
            status: 'aktif',
            partai_id: val,
            sistem: 'standard',
            kategori: p.kategori,
            no_urut: noUrut,
            babak: babak,
            kontingen: p.kontingen,
            nama: p.nama,
            waza: wazaList,
            numJudges: currentLocalJudges,
            playlist_antrean: playlistAntrean
        };
    }

    if (!payload) return;

    // 🔥 PEMBERSIHAN MUTLAK: Sapu bersih nilai wasit lama saat partai/sudut baru ditembak
    if (database) {
        database.ref(`live_embu/${safeCourtId}/juri`).set(null).catch(e => console.warn(e));
        database.ref(`live_embu/${safeCourtId}`).update(payload).catch(e => console.warn(e));
    }

    if (typeof localSocket !== 'undefined' && localSocket) {
        localSocket.emit('broadcast_to_tv', {
            channel: 'lokal_panitera',
            court: safeCourtId,
            payload: payload
        });
    }
}

function kunciLayarWasit() {
    const safeCourtId = DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';

    // 👇 SUNTIKAN JARINGAN LOKAL: Kunci layar wasit seketika tanpa internet
    if (typeof localSocket !== 'undefined' && localSocket !== null && localSocket.connected) {
        localSocket.emit('broadcast_to_tv', {
            channel: 'lokal_panitera',
            court: safeCourtId,
            payload: { status: 'locked' }
        });
    }

    if (!database) return; // 🛡️ SUNTIKAN ANTI-CRASH: Jangan tembak Firebase jika Lokal

    // Backup: Kirim sinyal 'locked' via Firebase
    database.ref(`live_embu/${safeCourtId}`).update({ status: 'locked' }).catch(err => console.error(err));
}

// =========================================================
// SUNTIKAN FINAL: JARINGAN MESH LOKAL (SOCKET.IO)
// Menerima tembakan nilai dari Wasit tanpa delay Firebase
// =========================================================
let localSocket = null;

function initLocalRealtimeMesh() {
    // 🔥 PENGAMAN: Jangan muat socket.io jika berjalan di domain cloud statis
    if (window.location.hostname.includes('github.io') || window.location.hostname.includes('netlify.app')) {
        console.log("☁️ Berjalan di Cloud Hosting Statis: Menggunakan Firebase RTDB.");
        return;
    }

    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';

    script.onload = () => {
        localSocket = io();
        localSocket.on('connect', () => console.log('🔥 Jalur Cepat Lokal (Socket.io) Terhubung!'));

        // ==========================================
        // 1. TELINGA UNTUK NILAI WASIT DIGITAL & SYNC
        // ==========================================
        localSocket.on('update_layar_tv', async (data) => {
            const safeCourtId = DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';

            if (data && data.channel === 'lokal_wasit' && data.court === safeCourtId) {
                injectLokalWasitScore(data);
            }

            if (data && data.channel === 'global_state_update') {
                if (SYSTEM_MODE.toLowerCase() === 'local' || SYSTEM_MODE.toLowerCase() === 'lokal') {
                    try {
                        const dataRes = await fetch('/api/data_turnamen');
                        if (dataRes.ok) {
                            const localData = await dataRes.json();
                            STATE.categories = localData.categories || [];
                            STATE.participants = localData.participants || [];
                            STATE.matches = localData.matches || [];
                            STATE.barcodes = localData.barcodes || [];
                            STATE.rundown = (localData.rundown_state && localData.rundown_state.schedule) ? localData.rundown_state.schedule : (localData.rundown || []);
                            if (localData.settings) STATE.settings = localData.settings;

                            refreshActiveUI();
                            console.log("🔄 Layar otomatis diperbarui dari perubahan laptop lain!");
                        }
                    } catch (e) {
                        console.warn("Gagal auto-refresh lokal:", e);
                    }
                }
            }
        });

        // ==========================================
        // 2. TELINGA UNTUK APLIKASI SCANNER APK (UNIVERSAL ROUTER)
        // ==========================================
        localSocket.on('scanner_inbox', (rawData) => {
            let data = rawData;
            if (typeof rawData === 'string') {
                try {
                    data = JSON.parse(rawData);
                } catch (e) {
                    console.warn("Format data scanner salah:", e);
                    return;
                }
            }

            const safeCourtId = DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';
            const isTujuanAdmin = (data.court === 'admin');

            // 🔥 SAKLAR 1: JIKA MODAL OTORISASI KOORDINATOR SEDANG DIBUKA DI LAPTOP
            const modalKoordinator = document.getElementById('modal-qr-koordinator');
            const isKoordinatorModalOpen = modalKoordinator && !modalKoordinator.classList.contains('hidden');

            if (isKoordinatorModalOpen && data.court === safeCourtId) {
                let isSuccess = processKoordinatorScan(data.url);
                localSocket.emit('scanner_feedback', {
                    id: data.id,
                    status: isSuccess ? 'SUCCESS' : 'FAILED',
                    court: safeCourtId
                });
                return;
            }

            // 🔥 SAKLAR 2: JIKA MODAL PERSETUJUAN PERTANDINGAN DIBUKA (WASIT/OFFICIAL)
            if (!isTujuanAdmin && data.court === safeCourtId) {
                let isSuccess = processVerificationUrl(data.url);
                localSocket.emit('scanner_feedback', {
                    id: data.id,
                    status: isSuccess ? 'SUCCESS' : 'FAILED',
                    court: safeCourtId
                });
            }
            // 🔥 SAKLAR 3: JIKA TUJUANNYA ADALAH ADMIN (PAIRING BARCODE)
            else if (isTujuanAdmin) {
                const isRadarOpen = !document.getElementById('pairing-radar-modal').classList.contains('hidden');

                if (isRadarOpen) {
                    let isSuccess = processPairingUrl(data.url, data.id);
                    localSocket.emit('scanner_feedback', {
                        id: data.id,
                        status: isSuccess ? 'SUCCESS' : 'FAILED',
                        court: 'admin'
                    });
                } else {
                    console.log("Data pairing masuk, tapi Radar Admin sedang ditutup.");
                }
            }
        });

    };
    script.onerror = () => console.warn("Menjalankan mode Cloud Murni (Tanpa Jaringan Mesh Lokal).");
    document.head.appendChild(script);
}

function injectLokalWasitScore(data) {
    const selectEl = document.getElementById('select-peserta');

    // Jangan ubah UI jika data yang masuk bukan untuk atlet yang sedang tampil di layar Panitera
    if (!selectEl || selectEl.value !== data.partai_id) return;

    const i = parseInt(data.posisi);
    const scoreData = data.payload;

    const inputScore = document.getElementById(`score-${i}`);
    const inputTech = document.getElementById(`tech-${i}`);
    const stempel = document.getElementById(`stempelJuri${i}`);
    const btnReset = document.getElementById(`btnReset${i}`);

    if (inputScore) {
        // Matikan bendera reset/loading agar tidak berkonflik dengan Firebase yang lambat
        if (typeof requestedResetJuri !== 'undefined') requestedResetJuri[i] = false;

        inputScore.value = scoreData.total;
        if (inputTech) inputTech.value = scoreData.teknik;
        TEMP_RINCIAN_WASIT[i] = scoreData.rincian || "";

        // Kunci input agar tidak bisa diedit sembarangan, ubah warna jadi Hijau (Selesai)
        inputScore.readOnly = true;
        if (inputTech) inputTech.readOnly = true;
        inputScore.classList.remove('text-yellow-500');
        inputScore.classList.add('text-green-400', 'font-black');

        if (stempel) stempel.classList.remove('hidden');

        if (btnReset) {
            btnReset.classList.remove('hidden');
            btnReset.className = "absolute top-0 right-0 bg-red-600 text-white w-8 h-8 rounded-bl-xl shadow-lg z-30 flex items-center justify-center hover:bg-red-500 transition-colors cursor-pointer";
            btnReset.innerHTML = '<i class="fas fa-lock text-xs"></i>';
            btnReset.title = "Buka Kunci Wasit";
        }

        // PAKSA HITUNG TOTAL DETIK ITU JUGA SECARA REAL-TIME!
        calculateLive();
    }
}

// Eksekusi Pemasangan Jaringan Mesh saat layar selesai dimuat
setTimeout(initLocalRealtimeMesh, 1500);

// =========================================================
// 🛡️ MODUL SANKSI BATSU, DISKUALIFIKASI & FAILSAFE QR
// =========================================================
let PENDING_SANCTION_DATA = null;
let qrScannerInstance = null;

/**
 * Memicu Modal Sanksi dengan Format Teks Partai yang Rapi
 */
function triggerBatsuModal(corner, type, points) {
    if (!currentRandoriMatchId) return alert("Pilih partai Randori terlebih dahulu!");

    const match = STATE.matches.find(m => m.id === currentRandoriMatchId);
    if (!match) return;

    const targetId = corner === 'merah' ? match.merahId : match.putihId;
    const opponentId = corner === 'merah' ? match.putihId : match.merahId;
    
    const athlete = STATE.participants.find(p => p.id === targetId) || { nama: 'ATLET ' + corner.toUpperCase(), kontingen: '-' };
    const opponent = STATE.participants.find(p => p.id === opponentId) || { nama: 'LAWAN', kontingen: '-' };

    // 🔥 FORMAT TEKS JELAS (Contoh: G-4 [Pool B] [Penyisihan 4] Randori Putra 50 - 55kg)
    let displayNum = match.matchNum % 50 === 0 ? 50 : match.matchNum % 50;
    let poolLabel = match.pool && match.pool !== '-' ? `Pool ${match.pool}` : 'Utama';
    let formattedGameDesc = `G-${displayNum} [${poolLabel}] [${match.babak}] ${match.kategori}`;

    PENDING_SANCTION_DATA = {
        corner: corner,
        type: type,
        points: points,
        athleteId: targetId,
        athleteName: athlete.nama,
        athleteKontingen: athlete.kontingen,
        opponentId: opponentId,
        opponentName: opponent.nama,
        opponentKontingen: opponent.kontingen,
        matchId: match.id,
        category: match.kategori,
        gameDesc: formattedGameDesc, // 👈 Disimpan dalam format deskriptif
        court: typeof DEVICE_ROLE !== 'undefined' ? DEVICE_ROLE : 'court_1'
    };

    const elAtlet = document.getElementById('modal-sanksi-atlet');
    const elKont = document.getElementById('modal-sanksi-kontingen');
    const elJenis = document.getElementById('modal-sanksi-jenis');
    
    if (elAtlet) elAtlet.innerText = `${athlete.nama} (${corner.toUpperCase()})`;
    if (elKont) elKont.innerText = athlete.kontingen;
    if (elJenis) elJenis.innerText = `${type} (+${points} POIN LAWAN)`;

    const modal = document.getElementById('modal-sanksi-randori');
    if (modal) modal.classList.remove('hidden');
}

function closeSanctionModal() {
    PENDING_SANCTION_DATA = null;
    const modal = document.getElementById('modal-sanksi-randori');
    if (modal) modal.classList.add('hidden');
}

/**
 * Eksekusi Konfirmasi Sanksi (Otomatis Sebar ke Pasangan Embu jika Diskualifikasi Total)
 */
function confirmSanctionExecution(sanctionLevel) {
    if (!PENDING_SANCTION_DATA) return;

    const { corner, points, athleteId, athleteName, gameDesc, category, opponentName, court } = PENDING_SANCTION_DATA;

    // 1. Tambahkan Poin Penalti ke Lawan di Laga Berjalan
    const oppCorner = corner === 'merah' ? 'putih' : 'merah';
    RANDORI_STATE[oppCorner].score += points;
    RANDORI_STATE[corner].warnings = (RANDORI_STATE[corner].warnings || 0) + 1;
    RANDORI_HISTORY.push({ corner: oppCorner, points: points, label: `${PENDING_SANCTION_DATA.type} (SANKSI)` });
    updateRandoriUI();

    // 2. Buat Catatan Riwayat Sanksi dengan Format Jelas
    const sanctionRecord = {
        statusSanksi: sanctionLevel,
        sanksiDetail: {
            tipe: sanctionLevel,
            penyebab: PENDING_SANCTION_DATA.type,
            gameId: gameDesc, // 👈 Sekarang berisi "G-4 [Pool B] [Penyisihan 4]..."
            kategori: category,
            lawan: opponentName,
            court: court,
            pelanggarUtama: athleteName,
            timestamp: new Date().toISOString()
        }
    };

    // 3. 🔥 SEBARKAN STATUS KE SEMUA NOMOR PERTANDINGAN ATLET (TERMASUK EMBU BERPASANGAN / REGU)
    let targetAthleteRawName = athleteName.trim().toLowerCase();

    STATE.participants.forEach(p => {
        let isMatch = false;

        if (p.id === athleteId) {
            isMatch = true;
        } else if (sanctionLevel === 'DISKUALIFIKASI_TOTAL') {
            // Cek apakah nama atlet ini ada di dalam nomor Embu (Tunggal / Pasangan / Regu)
            let individualNames = String(p.nama).split(/[,+&]/).map(n => n.trim().toLowerCase());
            if (individualNames.includes(targetAthleteRawName) || p.nama.toLowerCase().includes(targetAthleteRawName)) {
                isMatch = true;
            }
        }

        if (isMatch) {
            p.statusSanksi = sanctionLevel;
            p.sanksiDetail = sanctionRecord.sanksiDetail;
        }
    });

    // 4. Siarkan & Simpan Massal ke Seluruh Jaringan
    saveToLocalStorage();

    if (database) {
        let updates = {};
        STATE.participants.forEach((p, idx) => {
            if (p.statusSanksi && p.statusSanksi !== 'NORMAL') {
                updates[`turnamen_data/participants/${idx}/statusSanksi`] = p.statusSanksi;
                updates[`turnamen_data/participants/${idx}/sanksiDetail`] = p.sanksiDetail;
            }
        });
        database.ref().update(updates).catch(err => console.warn("Firebase Sanction Sync Error:", err));
    }

    closeSanctionModal();
    if (typeof pushRandoriToTV === 'function') {
        pushRandoriToTV();
    }
}

/**
 * Render Tirai Blokir Proporsional & Tombol Eksekusi WO pada Embu
 */
function renderEmbuSanctionUI(isBlocked, detail, matchId = null, blockedCorner = null) {
    const panelEmbu = document.getElementById('panel-embu');
    const judgeInputs = document.getElementById('judge-inputs');
    const bottomScoreBar = panelEmbu ? panelEmbu.querySelector('.bg-gradient-to-r') : null;
    if (!panelEmbu) return;

    let overlay = document.getElementById('overlay-sanksi-embu');

    if (isBlocked) {
        // 1. Sembunyikan form wasit di belakang agar tidak membuat layout bertumpuk
        if (judgeInputs) judgeInputs.classList.add('hidden');
        if (bottomScoreBar) bottomScoreBar.classList.add('hidden');

        panelEmbu.classList.remove('hidden');
        panelEmbu.className = "flex flex-col w-full min-h-[460px] relative items-center justify-center";

        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'overlay-sanksi-embu';
            overlay.className = "w-full h-full bg-slate-900/90 border border-red-500/40 rounded-2xl p-6 md:p-8 flex flex-col items-center justify-center text-center shadow-2xl animate-fade-in";
            panelEmbu.appendChild(overlay);
        }

        const isDiskul = detail && detail.tipe === 'DISKUALIFIKASI_TOTAL';
        const badgeText = isDiskul ? 'DISKUALIFIKASI TOTAL' : 'BATSU KATEGORI';
        const reasonText = detail ? detail.penyebab : 'Pelanggaran Disiplin';
        const gameText = detail && detail.gameId ? detail.gameId : 'Partai Sebelumnya';
        const oppText = detail && detail.lawan ? detail.lawan : '-';
        const violatorText = detail && detail.pelanggarUtama ? detail.pelanggarUtama : 'Atlet / Pasangan';

        // Deteksi apakah ini pertandingan Embu H2H (punya lawan langsung)
        const isH2H = matchId !== null && blockedCorner !== null;
        const opponentCornerText = blockedCorner === 'merah' ? 'PITA PUTIH' : 'PITA MERAH';

        overlay.innerHTML = `
            <div class="flex flex-col items-center max-w-xl w-full space-y-4">
                <!-- Icon Status -->
                <div class="w-14 h-14 rounded-2xl bg-red-600/10 border border-red-500/30 flex items-center justify-center text-red-500 shadow-inner">
                    <i class="fas fa-ban text-2xl"></i>
                </div>

                <!-- Header Status -->
                <div>
                    <span class="px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest border bg-red-950/80 text-red-400 border-red-700/60 shadow-sm">
                        ${badgeText}
                    </span>
                    <h4 class="text-white font-black text-lg uppercase tracking-wider mt-2">PARTISIPASI EMBU TERBLOKIR</h4>
                    <p class="text-xs text-slate-400 mt-0.5">Atlet atau pasangan terkena sanksi dan tidak diperkenankan melakukan penampilan.</p>
                </div>

                <!-- Box Audit Lengkap -->
                <div class="w-full bg-slate-950/80 border border-slate-800 rounded-xl p-4 text-left text-xs space-y-2 shadow-inner">
                    <div class="flex justify-between items-center border-b border-slate-800/80 pb-2">
                        <span class="text-slate-400 font-medium">Atlet Pelanggar:</span>
                        <span class="text-red-400 font-bold text-right">${violatorText}</span>
                    </div>
                    <div class="flex justify-between items-center border-b border-slate-800/80 pb-2">
                        <span class="text-slate-400 font-medium">Pelanggaran:</span>
                        <span class="text-amber-400 font-bold uppercase">${reasonText}</span>
                    </div>
                    <div class="flex flex-col sm:flex-row justify-between sm:items-center border-b border-slate-800/80 pb-2 gap-1">
                        <span class="text-slate-400 font-medium whitespace-nowrap">Riwayat Laga:</span>
                        <span class="text-slate-200 font-semibold text-right break-words">${gameText}</span>
                    </div>
                    <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-1">
                        <span class="text-slate-400 font-medium whitespace-nowrap">Lawan di Randori:</span>
                        <span class="text-slate-200 font-semibold text-right break-words">${oppText}</span>
                    </div>
                </div>

                <!-- Tombol Aksi Bersih & Fungsional -->
                <div class="grid grid-cols-1 ${isH2H ? 'sm:grid-cols-2' : ''} gap-3 w-full pt-1">
                    <button onclick="openQRKoordinatorModal('embu')" class="py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-amber-500/60 text-amber-400 font-bold text-xs uppercase tracking-widest transition-all shadow-md flex items-center justify-center gap-2">
                        <i class="fas fa-qrcode text-sm"></i> BUKA GEMBOK (QR DEWAN)
                    </button>

                    ${isH2H ? `
                    <button onclick="eksekusiEmbuH2H_WO(${matchId}, '${blockedCorner}')" class="py-3 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(220,38,38,0.4)] flex items-center justify-center gap-2">
                        <i class="fas fa-flag-checkered text-sm"></i> SIMPAN HASIL (MENANG WO)
                    </button>
                    ` : ''}
                </div>
            </div>
        `;
        overlay.classList.remove('hidden');
    } else {
        // Kembalikan form wasit jika blokir terbuka
        if (judgeInputs) judgeInputs.classList.remove('hidden');
        if (bottomScoreBar) bottomScoreBar.classList.remove('hidden');
        panelEmbu.className = "flex flex-col w-full";
        if (overlay) overlay.classList.add('hidden');
    }
}

/**
 * Eksekusi Kemenangan WO untuk Nomor Embu H2H
 */
function eksekusiEmbuH2H_WO(matchId, blockedCorner) {
    const match = STATE.matches.find(m => m.id === matchId);
    if (!match) return;

    const winnerCorner = blockedCorner === 'merah' ? 'putih' : 'merah';
    const winnerId = winnerCorner === 'merah' ? match.merahId : match.putihId;
    const loserId = blockedCorner === 'merah' ? match.merahId : match.putihId;

    const winnerAthlete = STATE.participants.find(p => p.id === winnerId);
    const loserAthlete = STATE.participants.find(p => p.id === loserId);

    const winnerName = winnerAthlete ? winnerAthlete.nama : "Pita Lawan";
    const winnerKontingen = winnerAthlete ? winnerAthlete.kontingen : "-";

    if (!confirm(`TETAPKAN PEMENANG WO:\n\nPartai: G-${match.matchNum % 50 === 0 ? 50 : match.matchNum % 50} (${match.kategori})\nPemenang: PITA ${winnerCorner.toUpperCase()} - ${winnerName} (${winnerKontingen})\nStatus Lawan: DISKUALIFIKASI / WO\n\nSimpan hasil dan perbarui bagan?`)) {
        return;
    }

    // 1. Catat Skor & Status Pertandingan
    if (blockedCorner === 'merah') {
        match.skorMerah = 0;
        match.skorPutih = match.skorPutih > 0 ? match.skorPutih : 10; // Default kemenangan
    } else {
        match.skorPutih = 0;
        match.skorMerah = match.skorMerah > 0 ? match.skorMerah : 10;
    }

    match.winnerId = winnerId;
    match.loserId = loserId;
    match.status = 'done';
    match.petugas = { wasitUtama: "SISTEM (WO)", offMerah: "PANITERA", offPutih: "PANITERA" };

    // 2. Alirkan Pemenang ke Bagan Babak Selanjutnya
    forwardParticipant(match.nextW, winnerId, match.kategori, match.pool, match.nextWSlot);
    if (match.nextL) {
        forwardParticipant(match.nextL, loserId, match.kategori, match.pool, match.nextLSlot);
    }

    processAutoWins(match.kategori);
    recalculateAllLosses(match.kategori);

    // 3. Simpan ke Database Lokal & Firebase
    saveToLocalStorage();

    let updates = {};
    updates['turnamen_data/matches'] = STATE.matches;
    updates['turnamen_data/participants'] = STATE.participants;

    if (database) {
        database.ref().update(updates).catch(e => console.warn("Firebase Sync Error:", e));
    }

    // 4. Siarkan Pengumuman Kemenangan WO ke Layar TV
    if (typeof IS_TV_LIVE !== 'undefined' && IS_TV_LIVE && DEVICE_ROLE !== 'admin') {
        let payloadTV = {
            payload_id: Date.now().toString() + "-EMBU-WO",
            type: 'embu',
            current_action: 'show_score',
            score_data: {
                kategori: match.kategori,
                nama: winnerName,
                kontingen: winnerKontingen,
                rawScores: [0, 0, 0, 0, 0],
                techScores: [0, 0, 0, 0, 0],
                waktu: "00:00",
                denda: 0,
                nilaiAkhir: "MENANG (WO)",
                pita: winnerCorner
            }
        };
        if (database) database.ref(`live_broadcast/${DEVICE_ROLE}`).set(payloadTV).catch(e => console.warn(e));
        if (typeof localSocket !== 'undefined' && localSocket) {
            localSocket.emit('broadcast_to_tv', { channel: 'global_tv', court: DEVICE_ROLE, payload: payloadTV });
        }
    }

    alert(`Partai G-${match.matchNum % 50 === 0 ? 50 : match.matchNum % 50} Selesai!\nPemenang: PITA ${winnerCorner.toUpperCase()} (${winnerName}).`);

    // 5. Pindah Otomatis ke Partai Selanjutnya
    if (ACTIVE_PLAYLIST.isActive) {
        autoNextPlaylistMatch();
    } else {
        filterPesertaScoring();
        checkExistingDrawing();
    }
}

function broadcastSanctionGlobal(athleteId, sanctionRecord) {
    // Jalur 1: Simpan ke Backend SQLite Lokal (LAN / Hybrid)
    saveToLocalStorage();

    // Jalur 2: Simpan langsung ke Root Participants Firebase (Online / Hybrid)
    if (database) {
        let pIdx = STATE.participants.findIndex(p => p.id === athleteId);
        if (pIdx > -1) {
            let updates = {};
            updates[`turnamen_data/participants/${pIdx}/statusSanksi`] = sanctionRecord.statusSanksi;
            updates[`turnamen_data/participants/${pIdx}/sanksiDetail`] = sanctionRecord.sanksiDetail;
            database.ref().update(updates).catch(err => console.warn("Firebase Sanction Sync Error:", err));
        }
    }

    // Jalur 3: Socket.io Realtime Sinyal Cepat
    if (typeof localSocket !== 'undefined' && localSocket && localSocket.connected) {
        localSocket.emit('broadcast_to_tv', {
            channel: 'global_sanction_sync',
            athleteId: athleteId,
            sanctionRecord: sanctionRecord
        });
    }
}

/**
 * Validasi apakah atlet diblokir di kategori ini
 */
function checkAthleteSanctionBlocked(athlete, currentCategory) {
    if (!athlete || !athlete.statusSanksi || athlete.statusSanksi === 'NORMAL') return false;
    if (athlete.statusSanksi === 'DISKUALIFIKASI_TOTAL') return true;
    if (athlete.statusSanksi === 'BATSU_KATEGORI') {
        return athlete.sanksiDetail && athlete.sanksiDetail.kategori === currentCategory;
    }
    return false;
}

/**
 * Render Tirai Blokir pada Sudut yang Terkena Sanksi
 */
/**
 * Render Tirai Blokir Penuh pada Sudut yang Terkena Sanksi
 */
function renderCornerSanctionUI(corner, isBlocked, detail) {
    // 1. Ambil container sudut utama secara presisi
    let sideContainer = document.getElementById(`side-${corner}-randori`);
    if (!sideContainer) {
        // Fallback jika ID belum dipasang di HTML
        const nameEl = document.getElementById(`randori-nama-${corner}`);
        const splitWrapper = nameEl ? nameEl.closest('.divide-slate-700\\/80') || nameEl.closest('.border-slate-700') : null;
        if (splitWrapper) {
            sideContainer = corner === 'merah' ? splitWrapper.children[0] : splitWrapper.children[1];
        }
    }
    if (!sideContainer) return;

    sideContainer.style.position = 'relative';
    let overlay = document.getElementById(`overlay-sanksi-${corner}`);

    if (isBlocked) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = `overlay-sanksi-${corner}`;
            // 🔥 Kunci mutlak: inset-0, z-40, backdrop-blur, pointer-events-auto agar tombol di bawah tidak bisa disentuh sama sekali
            overlay.className = "absolute inset-0 z-40 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center select-none animate-fade-in";
            sideContainer.appendChild(overlay);
        }

        const isDiskul = detail && detail.tipe === 'DISKUALIFIKASI_TOTAL';
        const badgeColor = isDiskul 
            ? 'bg-red-950/80 text-red-400 border-red-700/60' 
            : 'bg-amber-950/80 text-amber-400 border-amber-700/60';
        
        const badgeText = isDiskul ? 'DISKUALIFIKASI TOTAL' : 'BATSU KATEGORI';
        const reasonText = detail ? detail.penyebab : 'Pelanggaran Disiplin';
        const gameText = detail && detail.gameId ? `Game #${detail.gameId}` : 'Partai Sebelumnya';
        const oppText = detail && detail.lawan ? detail.lawan : '-';

        overlay.innerHTML = `
            <div class="flex flex-col items-center max-w-sm w-full space-y-4">
                <!-- Icon Status -->
                <div class="w-14 h-14 rounded-2xl bg-red-600/10 border border-red-500/30 flex items-center justify-center text-red-500 shadow-inner">
                    <i class="fas fa-ban text-2xl"></i>
                </div>

                <!-- Header Judul -->
                <div>
                    <span class="px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest border ${badgeColor}">
                        ${badgeText}
                    </span>
                    <h4 class="text-white font-black text-base uppercase tracking-wider mt-2">Partisipasi Terblokir</h4>
                    <p class="text-xs text-slate-400 mt-0.5">Sudut lawan otomatis menang mutlak (WO / IPPON +10).</p>
                </div>

                <!-- Box Audit Ringkas -->
                <div class="w-full bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 text-left text-xs space-y-1.5 shadow-inner">
                    <div class="flex justify-between items-center border-b border-slate-800/80 pb-1.5">
                        <span class="text-slate-500 font-medium">Pelanggaran:</span>
                        <span class="text-slate-200 font-bold">${reasonText}</span>
                    </div>
                    <div class="flex justify-between items-center border-b border-slate-800/80 pb-1.5">
                        <span class="text-slate-500 font-medium">Riwayat Laga:</span>
                        <span class="text-slate-200 font-bold">${gameText}</span>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="text-slate-500 font-medium">Lawan Asal:</span>
                        <span class="text-slate-200 font-bold truncate max-w-[160px] text-right" title="${oppText}">${oppText}</span>
                    </div>
                </div>

                <!-- Tombol Failsafe QR Dewan -->
                <button onclick="openQRKoordinatorModal('${corner}')" class="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-amber-500/50 hover:border-amber-400 text-amber-400 hover:text-amber-300 font-bold text-xs uppercase tracking-widest transition-all shadow-md flex items-center justify-center gap-2">
                    <i class="fas fa-qrcode text-sm"></i> BUKA GEMBOK (QR DEWAN)
                </button>
            </div>
        `;
        overlay.classList.remove('hidden');
    } else {
        if (overlay) overlay.classList.add('hidden');
    }
}

// =========================================================
// 🛡️ OTORISASI KOORDINATOR PERTANDINGAN (MOBILE SCANNER HP)
// =========================================================
let targetCornerToUnlock = null;
let VERIFIED_KOORDINATOR_DATA = null;
let koordinatorFirebaseRef = null;

/**
 * Buka Modal Radar Koordinator Pertandingan
 */
function openQRKoordinatorModal(target) {
    targetCornerToUnlock = target;
    VERIFIED_KOORDINATOR_DATA = null;

    const modal = document.getElementById('modal-qr-koordinator');
    const badgeCourt = document.getElementById('ui-court-badge-koordinator');
    const matchInfoEl = document.getElementById('k-match-info');
    const targetInfoEl = document.getElementById('k-target-info');
    const nameStatusEl = document.getElementById('k-name-status');
    const blockStatusEl = document.getElementById('k-block-status');
    const btnBuka = document.getElementById('btn-eksekusi-buka-gembok');

    const safeCourt = typeof DEVICE_ROLE !== 'undefined' && DEVICE_ROLE !== 'admin' ? DEVICE_ROLE : 'court_1';
    if (badgeCourt) badgeCourt.innerText = safeCourt.replace('_', ' ').toUpperCase();

    // Tampilkan detail partai yang terkunci
    if (target === 'embu') {
        let pName = document.getElementById('scoring-athlete-name') ? document.getElementById('scoring-athlete-name').innerText : '-';
        if (matchInfoEl) matchInfoEl.innerText = "Nomor Embu";
        if (targetInfoEl) targetInfoEl.innerText = `Atlet: ${pName}`;
    } else {
        const match = STATE.matches.find(m => m.id === currentRandoriMatchId);
        const pId = target === 'merah' ? (match ? match.merahId : null) : (match ? match.putihId : null);
        const p = STATE.participants.find(x => x.id === pId);
        if (matchInfoEl) matchInfoEl.innerText = match ? `G-${match.matchNum % 50 === 0 ? 50 : match.matchNum % 50} • ${match.kategori}` : "Randori";
        if (targetInfoEl) targetInfoEl.innerText = `Sudut ${target.toUpperCase()}: ${p ? p.nama : '-'}`;
    }

    // Reset status UI
    if (nameStatusEl) {
        nameStatusEl.innerText = "Menunggu Scan...";
        nameStatusEl.className = "font-bold text-slate-500 text-sm";
    }
    if (blockStatusEl) {
        blockStatusEl.className = "bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col items-center justify-center text-center transition-all duration-300 min-h-[90px]";
    }
    if (btnBuka) {
        btnBuka.disabled = true;
        btnBuka.className = "w-full bg-slate-800 border border-slate-700 text-slate-500 font-black py-4 rounded-xl shadow-md transition-all text-sm tracking-widest flex items-center justify-center gap-2 cursor-not-allowed";
    }

    if (modal) modal.classList.remove('hidden');

    // 🔥 PENGAMAN JALUR FIREBASE (Persis seperti openVerificationModal)
    if (DEVICE_ROLE !== 'admin' && database) {
        if (koordinatorFirebaseRef) koordinatorFirebaseRef.off();
        koordinatorFirebaseRef = database.ref(`scanner_inbox/${safeCourt}`);
        koordinatorFirebaseRef.on('child_added', (snapshot) => {
            const data = snapshot.val();
            if (data && data.url) {
                let isSuccess = processKoordinatorScan(data.url);
                database.ref(`scanner_feedback/${safeCourt}`).set({
                    id: snapshot.key,
                    status: isSuccess ? 'SUCCESS' : 'FAILED',
                    timestamp: Date.now()
                });
                snapshot.ref.remove();
            }
        });
    }
}

/**
 * Memproses Barcode Scan dari HP Panitera Khusus Koordinator
 */
function processKoordinatorScan(rawUrl) {
    if (!rawUrl) return false;
    let scanned = String(rawUrl).trim();
    let isValid = false;
    let koordinatorName = "Koordinator Pertandingan";

    // 1. Uji Format JSON
    try {
        let obj = JSON.parse(scanned);
        let role = String(obj.jabatan || obj.role || '').toUpperCase();
        if (role.includes('KOORDINATOR')) {
            isValid = true;
            koordinatorName = obj.nama || koordinatorName;
        }
    } catch (e) {}

    // 2. Uji Database Barcode (STATE.barcodes)
    if (!isValid && STATE.barcodes && STATE.barcodes.length > 0) {
        let found = STATE.barcodes.find(b => {
            let isKoord = String(b.jabatan || '').toUpperCase().includes('KOORDINATOR');
            if (!isKoord) return false;

            let mUrl = b.barcodeUrl && scanned.includes(b.barcodeUrl);
            let mShort = b.shortId && scanned.toUpperCase().includes(b.shortId.toUpperCase());
            let mId = String(b.id) === scanned;
            let mNama = scanned.toLowerCase().includes(String(b.nama || '').toLowerCase());

            return mUrl || mShort || mId || mNama;
        });

        if (found) {
            isValid = true;
            koordinatorName = found.nama;
        }
    }

    // 3. Uji String Mengandung Kata Kunci
    if (!isValid && scanned.toUpperCase().includes('KOORDINATOR')) {
        isValid = true;
        koordinatorName = "Koordinator Pertandingan";
    }

    const nameStatusEl = document.getElementById('k-name-status');
    const blockStatusEl = document.getElementById('k-block-status');
    const btnBuka = document.getElementById('btn-eksekusi-buka-gembok');

    if (isValid) {
        VERIFIED_KOORDINATOR_DATA = { nama: koordinatorName };

        if (nameStatusEl) {
            nameStatusEl.innerText = `TERVERIFIKASI: ${koordinatorName.toUpperCase()}`;
            nameStatusEl.className = "font-black text-green-400 text-sm tracking-wide";
        }
        if (blockStatusEl) {
            blockStatusEl.className = "bg-green-950/40 border-2 border-green-500 rounded-xl p-4 flex flex-col items-center justify-center text-center transition-all duration-300 min-h-[90px] shadow-[0_0_20px_rgba(34,197,94,0.25)]";
        }
        if (btnBuka) {
            btnBuka.disabled = false;
            btnBuka.className = "w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-transform hover:scale-[1.02] text-sm tracking-widest flex items-center justify-center gap-2 cursor-pointer";
        }
        return true;
    } else {
        if (nameStatusEl) {
            nameStatusEl.innerText = "Ditolak: Bukan ID Koordinator Pertandingan";
            nameStatusEl.className = "font-black text-red-400 text-xs";
        }
        if (blockStatusEl) {
            blockStatusEl.className = "bg-red-950/40 border border-red-700 rounded-xl p-4 flex flex-col items-center justify-center text-center transition-all duration-300 min-h-[90px]";
        }
        return false;
    }
}

/**
 * Eksekusi Buka Gembok Sanksi
 */
function eksekusiBukaGembokKoordinator() {
    if (!VERIFIED_KOORDINATOR_DATA) return;
    const koordinatorName = VERIFIED_KOORDINATOR_DATA.nama;

    // A. PEMBUKAAN PADA NOMOR EMBU
    if (targetCornerToUnlock === 'embu') {
        const val = document.getElementById('select-peserta').value;
        let targetPId = null;
        if (val.startsWith('h2h-match-')) targetPId = parseInt(val.split('-')[4]);
        else if (val.includes('|')) targetPId = parseInt(val.split('|')[0]);

        const p = STATE.participants.find(x => x.id === targetPId);
        if (p) {
            let targetName = p.sanksiDetail && p.sanksiDetail.pelanggarUtama ? p.sanksiDetail.pelanggarUtama.toLowerCase() : p.nama.toLowerCase();

            STATE.participants.forEach(item => {
                if (item.nama.toLowerCase().includes(targetName)) {
                    item.statusSanksi = 'NORMAL';
                    item.sanksiDetail = null;
                }
            });

            saveToLocalStorage();
            renderEmbuSanctionUI(false, null);
            updateScoringButtonsUI();
            closeQRKoordinatorModal();
            alert(`OTORISASI DITERIMA:\nSanksi diskualifikasi ${p.nama} telah dicabut oleh Koordinator Pertandingan (${koordinatorName}).`);
        }
        return;
    }

    // B. PEMBUKAAN PADA NOMOR RANDORI
    const match = STATE.matches.find(m => m.id === currentRandoriMatchId);
    if (!match) return;

    const targetId = targetCornerToUnlock === 'merah' ? match.merahId : match.putihId;
    const athlete = STATE.participants.find(p => p.id === targetId);

    if (athlete) {
        let targetName = athlete.nama.toLowerCase();
        STATE.participants.forEach(item => {
            if (item.nama.toLowerCase().includes(targetName)) {
                item.statusSanksi = 'NORMAL';
                item.sanksiDetail = null;
            }
        });

        saveToLocalStorage();
        const overlay = document.getElementById(`overlay-sanksi-${targetCornerToUnlock}`);
        if (overlay) overlay.classList.add('hidden');

        RANDORI_STATE.merah.score = 0;
        RANDORI_STATE.putih.score = 0;
        updateRandoriUI();

        closeQRKoordinatorModal();
        alert(`OTORISASI DITERIMA:\nSanksi atlet ${athlete.nama} telah dicabut oleh Koordinator Pertandingan (${koordinatorName}).`);
    }
}

/**
 * Tutup Modal & Matikan Listener Firebase
 */
function closeQRKoordinatorModal() {
    if (koordinatorFirebaseRef) {
        koordinatorFirebaseRef.off();
        koordinatorFirebaseRef = null;
    }
    const modal = document.getElementById('modal-qr-koordinator');
    if (modal) modal.classList.add('hidden');
    targetCornerToUnlock = null;
    VERIFIED_KOORDINATOR_DATA = null;
}
