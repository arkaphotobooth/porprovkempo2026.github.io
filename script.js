/**
 * MASS - Martial Arts Scoring System (FIREBASE ONLINE VERSION)
 */

// 1. Konfigurasi Rahasia Firebase Anda
const firebaseConfig = {
    apiKey: "AIzaSyA63UtPlhEdC9qKmmHVpDjGv_4RqWjK47k",
    authDomain: "mass-pro-turnamen.firebaseapp.com",
    projectId: "mass-pro-turnamen",
    databaseURL: "https://mass-pro-turnamen-default-rtdb.asia-southeast1.firebasedatabase.app/",
    storageBucket: "mass-pro-turnamen.firebasestorage.app",
    messagingSenderId: "268290671498",
    appId: "1:268290671498:web:d55e4960e392f7dfc8fe73"
};

// 2. Inisialisasi Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// 3. Deklarasi State Global (WAJIB DI ATAS SEBELUM FIREBASE)
let STATE = { categories: [], participants: [], matches: [], settings: { numJudges: 5, minPesertaJuara: 1 } };
const UI = { tabs: ['kategori', 'atlet', 'drawing', 'scoring', 'ranking', 'juara', 'admin'], timerInterval: null, timerSeconds: 0 };
let RANDORI_STATE = { merah: { score: 0, warn1: false, warn2: false }, putih: { score: 0, warn1: false, warn2: false } };
let SWAP_SELECTION = null;
let EMBU_SWAP_SELECTION = null; // Memori untuk menyimpan atlet pertama yang diklik

// --- SENSOR KONEKSI FIREBASE ---
const statusDot = document.getElementById('koneksi-dot');
const statusText = document.getElementById('koneksi-text');

// 1. INDIKATOR ONLINE/OFFLINE
database.ref('.info/connected').on('value', (snap) => {
    if (snap.val() === true) {
        if(statusDot) statusDot.className = 'w-2.5 h-2.5 bg-green-500 rounded-full transition-colors duration-300 shadow-[0_0_8px_rgba(34,197,94,0.8)]';
        if(statusText) statusText.innerText = 'ONLINE (FIREBASE)';
    } else {
        if(statusDot) statusDot.className = 'w-2.5 h-2.5 bg-red-500 rounded-full transition-colors duration-300';
        if(statusText) statusText.innerText = 'MENGHUBUNGKAN...';
    }
});

// 2. SINKRONISASI DATA REAL-TIME DARI SERVER
database.ref('turnamen_data').on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
        STATE.categories = data.categories || [];
        STATE.participants = data.participants || [];
        STATE.matches = data.matches || [];
        if(data.settings) STATE.settings = data.settings;
    }
    
    refreshAllData();
    if(document.getElementById('section-drawing') && !document.getElementById('section-drawing').classList.contains('hidden')) checkExistingDrawing();
    if(document.getElementById('section-scoring') && !document.getElementById('section-scoring').classList.contains('hidden')) filterPesertaScoring();
    if(document.getElementById('section-ranking') && !document.getElementById('section-ranking').classList.contains('hidden')) renderRanking();
    if(document.getElementById('section-juara') && !document.getElementById('section-juara').classList.contains('hidden')) renderJuaraUmum();
    
    let minEl = document.getElementById('setting-min-peserta'); 
    if(minEl && !document.getElementById('section-admin').classList.contains('hidden')) {
        minEl.value = STATE.settings.minPesertaJuara || 1; 
    }
    // --- FIX BUG SAKLAR: Sinkronkan dengan data Firebase ---
    let modeEl = document.getElementById('setting-tournament-mode');
    if(modeEl) {
        modeEl.value = (STATE.settings && STATE.settings.tournamentMode) ? STATE.settings.tournamentMode : 'double';
    }
}); // <-- Ini adalah penutup fungsi Firebase on('value')

// 5. UBAH FUNGSI LOKAL MENJADI CLOUD
// Membajak fungsi asli Anda agar menembak ke Firebase, bukan ke laptop lokal
function saveToLocalStorage() { 
    console.log("Mencoba menyimpan data ke Firebase...", STATE);
    database.ref('turnamen_data').set({
        categories: STATE.categories,
        participants: STATE.participants,
        matches: STATE.matches,
        settings: STATE.settings
    }).then(() => {
        console.log("SUKSES: Data berhasil disimpan ke server Google!");
    }).catch((error) => {
        console.error("GAGAL SIMPAN:", error);
        alert("Gagal menyimpan data ke database. Cek pengaturan 'Rules' di Firebase Console.");
    });
}

// INJEKSI DOM UNTUK TOMBOL EXPORT ADMIN (Tanpa ubah HTML)
document.addEventListener('DOMContentLoaded', () => { 
    refreshAllData(); 
    setJudges(5); 
    injectAdminExportButtons();
});

function injectAdminExportButtons() {
    const adminExportSection = document.querySelector('#section-admin .bg-dark-card.text-center');
    if (adminExportSection) {
        let currentMode = (STATE.settings && STATE.settings.tournamentMode) ? STATE.settings.tournamentMode : 'double';
        adminExportSection.innerHTML = `
            <div class="mt-2 bg-slate-800 p-5 rounded-xl border border-slate-700 text-left mb-6 shadow-lg">
                <h3 class="text-lg font-black text-yellow-400 mb-2"><i class="fas fa-cogs mr-2"></i>SISTEM TURNAMEN RANDORI</h3>
                <p class="text-xs text-slate-400 mb-4">Pilih sistem bagan. Perubahan ini akan berlaku untuk kategori Randori yang <b class="text-white">baru akan di-generate</b>.</p>
                <select id="setting-tournament-mode" onchange="saveTournamentMode()" class="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white font-bold cursor-pointer hover:border-blue-500 transition-colors">
                    <option value="double" ${currentMode === 'double' ? 'selected' : ''}>Mode PERKEMI (Double Elimination + Suden Death)</option>
                    <option value="single" ${currentMode === 'single' ? 'selected' : ''}>Mode UMUM (Single Elimination / Gugur Biasa)</option>
                </select>
            </div>
            <h2 class="text-xl font-black text-white mb-2"><i class="fas fa-download text-green-500 mr-2"></i>Pusat Export Data (Makro)</h2>
            <p class="text-sm text-slate-400 mb-6">Unduh seluruh rekapitulasi data global (semua kategori).</p>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button onclick="exportDrawingCSV()" class="bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 px-4 rounded-xl transition-transform hover:scale-105 shadow-lg text-sm flex flex-col items-center justify-center gap-2"><i class="fas fa-sitemap text-2xl"></i><span>Semua Jadwal & Drawing</span></button>
                <button onclick="exportHasilCSV()" class="bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 px-4 rounded-xl transition-transform hover:scale-105 shadow-lg text-sm flex flex-col items-center justify-center gap-2"><i class="fas fa-trophy text-2xl"></i><span>Semua Hasil & Juara</span></button>
                <button onclick="exportMedaliCSV()" class="bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-4 px-4 rounded-xl transition-transform hover:scale-105 shadow-lg text-sm flex flex-col items-center justify-center gap-2"><i class="fas fa-medal text-2xl"></i><span>Klasemen Medali Akhir</span></button>
            </div>
        `;
    }
}
function saveTournamentMode() {
    if(!STATE.settings) STATE.settings = {};
    STATE.settings.tournamentMode = document.getElementById('setting-tournament-mode').value;
    saveToLocalStorage();
    alert("Sistem turnamen berhasil diubah menjadi: " + (STATE.settings.tournamentMode === 'single' ? "SINGLE ELIMINATION (Gugur)" : "DOUBLE ELIMINATION (Perkemi)"));
}

function refreshAllData() { renderCategoryList(); updateAllDropdowns(); renderParticipantTable(); }

function switchTab(targetTab) {
    UI.tabs.forEach(tab => {
        const sectionEl = document.getElementById(`section-${tab}`); const tabEl = document.getElementById(`tab-${tab}`);
        if (sectionEl) { sectionEl.classList.add('hidden'); sectionEl.classList.remove('block'); }
        if (tabEl) { tabEl.classList.remove('active-tab', 'text-blue-500', 'text-red-400', 'text-yellow-400'); if(tab === 'admin') tabEl.classList.add('text-red-400'); else if(tab === 'juara') tabEl.classList.add('text-yellow-500'); else tabEl.classList.add('text-slate-400'); }
    });
    const activeSection = document.getElementById(`section-${targetTab}`); const activeTab = document.getElementById(`tab-${targetTab}`);
    if (activeSection) { activeSection.classList.remove('hidden'); activeSection.classList.add('block'); }
    if (activeTab) { if(targetTab === 'admin') { activeTab.classList.remove('text-red-400'); activeTab.classList.add('active-tab', 'text-red-500'); } else if(targetTab === 'juara') { activeTab.classList.remove('text-yellow-500'); activeTab.classList.add('active-tab', 'text-yellow-400'); } else { activeTab.classList.remove('text-slate-400'); activeTab.classList.add('active-tab', 'text-blue-500'); } }
    
    if(targetTab === 'ranking') renderRanking(); 
    if(targetTab === 'scoring') filterPesertaScoring(); 
    if(targetTab === 'drawing') { SWAP_SELECTION = null; updateAllDropdowns(); checkExistingDrawing(); } 
    if(targetTab === 'juara') renderJuaraUmum();
    if(targetTab === 'admin') { 
        let minEl = document.getElementById('setting-min-peserta'); 
        if(minEl) minEl.value = (STATE.settings && STATE.settings.minPesertaJuara) ? STATE.settings.minPesertaJuara : 1; 
        
        // --- FIX BUG SAKLAR: Sinkronkan saat buka tab ---
        let modeEl = document.getElementById('setting-tournament-mode');
        if(modeEl) modeEl.value = (STATE.settings && STATE.settings.tournamentMode) ? STATE.settings.tournamentMode : 'double';
    }
} //

document.getElementById('form-kategori').addEventListener('submit', (e) => { e.preventDefault(); const name = document.getElementById('cat-name').value.trim(); const type = parseInt(document.getElementById('cat-type').value); const discipline = document.getElementById('cat-discipline').value; if(!name) return; if(STATE.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) return alert("Kategori sudah ada!"); STATE.categories.push({ id: Date.now(), name, type, discipline }); saveToLocalStorage(); refreshAllData(); e.target.reset(); });
function renderCategoryList() { const container = document.getElementById('list-kategori'); if(STATE.categories.length === 0) return container.innerHTML = `<span class="text-sm text-slate-500 italic">Belum ada kategori.</span>`; container.innerHTML = STATE.categories.map(c => { let badgeColor = c.discipline === 'randori' ? 'bg-red-700' : 'bg-blue-600'; let disciplineText = c.discipline ? c.discipline.toUpperCase() : 'EMBU'; return `<div class="bg-slate-800 px-4 py-2 rounded-lg text-sm flex items-center gap-3 border border-slate-700 shadow-sm"><span class="${badgeColor} text-[9px] px-1.5 py-0.5 rounded font-bold">${disciplineText}</span><span class="font-bold text-white">${c.name}</span><span class="bg-slate-700 text-[10px] px-2 py-0.5 rounded text-slate-300">${c.type} Org</span><button onclick="deleteCategory(${c.id})" class="text-slate-500 hover:text-red-400 ml-2"><i class="fas fa-times"></i></button></div>` }).join(''); }
function deleteCategory(id) { if(confirm("Hapus kategori ini?")) { STATE.categories = STATE.categories.filter(c => c.id !== id); saveToLocalStorage(); refreshAllData(); } }

function updateAllDropdowns() { 
    // 1. Simpan memori pilihan user saat ini sebelum di-reset
    const valP = document.getElementById('p-kategori').value;
    const valEdit = document.getElementById('edit-kategori').value;
    const valDraw = document.getElementById('draw-select-kategori').value;
    const valSelect = document.getElementById('select-kategori').value;
    const valRank = document.getElementById('rank-filter-kategori').value;
    const valFilterAtlet = document.getElementById('filter-atlet-kategori').value;

    // 2. Buat ulang daftar `<option>`
    const options = STATE.categories.map(c => `<option value="${c.name}">${c.name}</option>`).join(''); 
    const emptyOpt = `<option value="">-- Pilih Kategori --</option>`; 
    const allOpt = '<option value="all">Semua Kategori</option>'; 
    
    // 3. Masukkan daftar baru ke dalam HTML
    document.getElementById('p-kategori').innerHTML = emptyOpt + options; 
    document.getElementById('edit-kategori').innerHTML = emptyOpt + options; 
    document.getElementById('draw-select-kategori').innerHTML = emptyOpt + options; 
    document.getElementById('select-kategori').innerHTML = emptyOpt + options; 
    document.getElementById('rank-filter-kategori').innerHTML = emptyOpt + options; 
    document.getElementById('filter-atlet-kategori').innerHTML = allOpt + options; 

    // 4. Kembalikan pilihan user yang tadi disimpan (jika ada)
    if (valP) document.getElementById('p-kategori').value = valP;
    if (valEdit) document.getElementById('edit-kategori').value = valEdit;
    if (valDraw) document.getElementById('draw-select-kategori').value = valDraw;
    if (valSelect) document.getElementById('select-kategori').value = valSelect;
    if (valRank) document.getElementById('rank-filter-kategori').value = valRank;
    if (valFilterAtlet) document.getElementById('filter-atlet-kategori').value = valFilterAtlet;
}

function handleCSVUpload(event) { 
    const file = event.target.files[0]; if (!file) return; 
    const reader = new FileReader(); 
    reader.onload = function(e) { 
        const rows = e.target.result.split('\n'); 
        let count = 0; 
        rows.forEach((row, i) => { 
            if(i === 0 || !row.trim()) return; 
            let cols = []; let curr = ''; let inQuotes = false;
            for(let char of row) {
                if(char === '"') inQuotes = !inQuotes;
                else if(char === ',' && !inQuotes) { cols.push(curr); curr = ''; }
                else curr += char;
            }
            cols.push(curr);
            cols = cols.map(item => item.replace(/^"|"$/g, '').trim());

            if(cols.length >= 3) { 
                const nama = cols[0], kontingen = cols[1], kategori = cols[2]; 
                if(nama && STATE.categories.some(c => c.name.toLowerCase() === kategori.toLowerCase())) { 
                    STATE.participants.push({ id: Date.now() + i, nama, kontingen, kategori, urut: 0, pool: '-', isFinalist: false, urutFinal: 0, losses: 0, scores: { b1: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 }, b2: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 } }, finalScore: 0, techScore: 0 }); count++; 
                } 
            } 
        }); 
        saveToLocalStorage(); refreshAllData(); event.target.value = ''; alert(`${count} Tim/Atlet diimport sukses.`); 
    }; 
    reader.readAsText(file); 
}

// Fungsi Baru: Upload CSV Khusus Kategori
function handleCategoryCSVUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const rows = e.target.result.split('\n');
        let count = 0;
        rows.forEach((row, i) => {
            if(i === 0 || !row.trim()) return; // Lewati baris pertama (header)
            let cols = row.split(',').map(item => item.replace(/^"|"$/g, '').trim());
            if(cols.length >= 3) {
                const discipline = cols[0].toLowerCase().includes('randori') ? 'randori' : 'embu';
                const name = cols[1];
                const type = parseInt(cols[2]) || 1;
                
                // Cek agar tidak duplikat
                if(name && !STATE.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
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
function saveMinPesertaSetting() {
    const val = parseInt(document.getElementById('setting-min-peserta').value);
    if(!val || val < 1) return alert("Angka minimal adalah 1.");
    if(!STATE.settings) STATE.settings = {};
    STATE.settings.minPesertaJuara = val;
    saveToLocalStorage();
    alert("Syarat Minimal Peserta diperbarui menjadi " + val);
    renderJuaraUmum();
}

document.getElementById('form-peserta').addEventListener('submit', (e) => { e.preventDefault(); const catName = document.getElementById('p-kategori').value; if(!catName) return alert("Pilih kategori!"); STATE.participants.push({ id: Date.now(), nama: document.getElementById('p-nama').value, kontingen: document.getElementById('p-kontingen').value, kategori: catName, urut: 0, pool: '-', isFinalist: false, urutFinal: 0, losses: 0, scores: { b1: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 }, b2: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 } }, finalScore: 0, techScore: 0 }); saveToLocalStorage(); renderParticipantTable(); document.getElementById('p-nama').value = ''; document.getElementById('p-nama').focus(); });

// --- VARIABEL GLOBAL PAGINATION ---
let currentAthletePage = 1;
const ATHLETES_PER_PAGE = 50;

function renderParticipantTable(resetPage = false) { 
    if (resetPage) currentAthletePage = 1; // Reset ke halaman 1 jika filter berubah

    const body = document.getElementById('table-peserta-body'); 
    const filter = document.getElementById('filter-atlet-kategori').value; 
    let list = filter && filter !== 'all' ? STATE.participants.filter(p => p.kategori === filter) : STATE.participants; 
    
    // --- UPDATE UI PAGINATION ---
    const totalItems = list.length;
    const totalPages = Math.ceil(totalItems / ATHLETES_PER_PAGE) || 1;
    if (currentAthletePage > totalPages) currentAthletePage = totalPages;

    const infoEl = document.getElementById('pagination-info');
    const btnPrev = document.getElementById('btn-prev-page');
    const btnNext = document.getElementById('btn-next-page');

    if (totalItems === 0) {
        if(infoEl) infoEl.innerText = `Menampilkan 0 atlet`;
        if(btnPrev) btnPrev.disabled = true;
        if(btnNext) btnNext.disabled = true;
        return body.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-slate-500">Tidak ada data.</td></tr>`;
    }

    const startIndex = (currentAthletePage - 1) * ATHLETES_PER_PAGE;
    const endIndex = Math.min(startIndex + ATHLETES_PER_PAGE, totalItems);

    if(infoEl) infoEl.innerText = `Menampilkan ${startIndex + 1} - ${endIndex} dari ${totalItems} Atlet`;
    if(btnPrev) btnPrev.disabled = currentAthletePage === 1;
    if(btnNext) btnNext.disabled = currentAthletePage === totalPages;
    // ----------------------------

    let sortedList = [...list].sort((a,b) => a.kategori === b.kategori ? a.urut - b.urut : a.kategori.localeCompare(b.kategori)); 
    
    // POTONG DATA UNTUK HALAMAN INI SAJA (MAX 50)
    let paginatedList = sortedList.slice(startIndex, endIndex);

    // --- STRATEGI A: MEMOIZATION (BUKU CONTEKAN) ---
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
    // -----------------------------------------------

    body.innerHTML = paginatedList.map(p => { 
        let catObj = STATE.categories.find(c => c.name === p.kategori);
        let isRandori = catObj && catObj.discipline === 'randori';
        let isRandoriDrawn = isRandori ? cachedRandoriDrawn[p.kategori] : false;
        
        let baseStatus = '';
        let resultBadge = '';

        // 1. TENTUKAN STATUS UNDIAN (Dasar)
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

        // 2. TENTUKAN STATUS JUARA / GUGUR (Lencana)
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
                let catParts = STATE.participants.filter(x => x.kategori === p.kategori && x.isFinalist && x.scores.b2.final > 0).sort((a,b) => b.scores.b2.final - a.scores.b2.final || b.scores.b2.tech - a.scores.b2.tech);
                let rank = catParts.findIndex(x => x.id === p.id);
                if (rank === 0) { isJuara = true; resultBadge = `<span class="bg-yellow-500 text-black text-[10px] px-2 py-0.5 rounded ml-2 font-bold shadow-sm">Juara 1</span>`; }
                else if (rank === 1) { isJuara = true; resultBadge = `<span class="bg-slate-300 text-black text-[10px] px-2 py-0.5 rounded ml-2 font-bold shadow-sm">Juara 2</span>`; }
                else if (rank === 2) { isJuara = true; resultBadge = `<span class="bg-amber-600 text-white text-[10px] px-2 py-0.5 rounded ml-2 font-bold shadow-sm">Juara 3</span>`; }
            } else if (!p.isFinalist && p.scores.b1.final > 0 && !STATE.participants.some(x => x.kategori === p.kategori && x.isFinalist)) {
                let catParts = STATE.participants.filter(x => x.kategori === p.kategori && x.pool === p.pool && x.scores.b1.final > 0).sort((a,b) => b.scores.b1.final - a.scores.b1.final || b.scores.b1.tech - a.scores.b1.tech);
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

// FUNGSI UNTUK PINDAH HALAMAN
function changeAthletePage(delta) {
    currentAthletePage += delta;
    renderParticipantTable();
}

function deletePeserta(id) { if(confirm('Hapus atlet ini?')) { STATE.participants = STATE.participants.filter(p => p.id !== id); saveToLocalStorage(); renderParticipantTable(); } }
function openEditModal(id) { const p = STATE.participants.find(x => x.id === id); if(!p) return; document.getElementById('edit-id').value = p.id; document.getElementById('edit-nama').value = p.nama; document.getElementById('edit-kontingen').value = p.kontingen; document.getElementById('edit-kategori').value = p.kategori; document.getElementById('edit-modal').classList.remove('hidden'); }
function closeEditModal() { document.getElementById('edit-modal').classList.add('hidden'); }
document.getElementById('form-edit-peserta').addEventListener('submit', (e) => { e.preventDefault(); const id = parseInt(document.getElementById('edit-id').value); const newKategori = document.getElementById('edit-kategori').value; const idx = STATE.participants.findIndex(p => p.id === id); if(idx > -1) { if(STATE.participants[idx].kategori !== newKategori) { STATE.participants[idx].urut = 0; STATE.participants[idx].pool = '-'; STATE.participants[idx].isFinalist = false; STATE.participants[idx].losses = 0; STATE.participants[idx].scores = { b1: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time:0 }, b2: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time:0 } }; STATE.participants[idx].finalScore = 0; STATE.participants[idx].techScore = 0; } STATE.participants[idx].nama = document.getElementById('edit-nama').value; STATE.participants[idx].kontingen = document.getElementById('edit-kontingen').value; STATE.participants[idx].kategori = newKategori; saveToLocalStorage(); renderParticipantTable(); closeEditModal(); alert("Data diperbarui."); } });

const TEMPLATE_4_STANDARD = [ 
    { matchNum: 1, babak: "Semi-Final", col: 1, slot1: 1, slot2: 2, nextW: 3, nextWSlot: 1, nextL: 4, nextLSlot: 1 }, 
    { matchNum: 2, babak: "Semi-Final", col: 1, slot1: 3, slot2: 4, nextW: 3, nextWSlot: 2, nextL: 4, nextLSlot: 2 }, 
    { matchNum: 3, babak: "FINAL ATAS", col: 2, slot1: null, slot2: null, nextW: 6, nextWSlot: 1, nextL: 5, nextLSlot: 2 }, 
    { matchNum: 4, babak: "LB S-Final", col: 2, slot1: null, slot2: null, nextW: 5, nextWSlot: 1, nextL: null }, 
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

function generateRandoriBracket() {
    const container = document.getElementById('randori-bracket-view');
    const wrapper = document.getElementById('randori-bracket-container');
    SWAP_SELECTION = null;

    try {
        const catName = document.getElementById('draw-select-kategori').value;
        if(!catName) return alert("Pilih kategori Randori terlebih dahulu!");
        
        const isFinalCategory = catName.toUpperCase().includes('FINAL');
        let athletes = STATE.participants.filter(p => p.kategori === catName);
        if(isFinalCategory) athletes = athletes.sort((a,b) => a.id - b.id);
        
        const count = athletes.length;
        if(count === 0) return alert("Belum ada peserta di kategori ini!");
        
        const existingMatches = STATE.matches.filter(m => m.kategori === catName);
        if(existingMatches.length > 0) {
            if(!confirm("Bagan sudah ada! Mengacak ulang akan menghapus semua data pertandingan dan BAGAN AKAN BERUBAH. Yakin?")) return;
            STATE.matches = STATE.matches.filter(m => m.kategori !== catName);
            STATE.participants.filter(p => p.kategori === catName).forEach(p => p.losses = 0);
        }

        let poolConfigs = [];
        let mode = (STATE.settings && STATE.settings.tournamentMode) ? STATE.settings.tournamentMode : 'double';

        if(count <= 4) {
            let temp4 = mode === 'single' ? SINGLE_TEMPLATE_4 : (isFinalCategory ? TEMPLATE_4_CROSS : TEMPLATE_4_STANDARD);
            poolConfigs.push({ name: '-', template: temp4, size: 4, athletes: athletes, isCrossover: (isFinalCategory && mode === 'double') });
        } else if (count <= 8) {
            let temp8 = mode === 'single' ? SINGLE_TEMPLATE_8 : TEMPLATE_8_PERKEMI;
            poolConfigs.push({ name: '-', template: temp8, size: 8, athletes: athletes, isCrossover: false });
        } else if (count <= 32) {
            if(!confirm(`Terdapat ${count} peserta. Sistem akan memecah menjadi 2 Pool (A dan B). Lanjutkan?`)) return;
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
            
            poolA.forEach(a => { const p = STATE.participants.find(x=>x.id===a.id); if(p) p.pool = 'A'; });
            poolB.forEach(a => { const p = STATE.participants.find(x=>x.id===a.id); if(p) p.pool = 'B'; });
            
            let sizeA = poolA.length <= 4 ? 4 : (poolA.length <= 8 ? 8 : 16);
            let tempA = mode === 'single' ? (sizeA===4?SINGLE_TEMPLATE_4:(sizeA===8?SINGLE_TEMPLATE_8:SINGLE_TEMPLATE_16)) : (sizeA===4?TEMPLATE_4_STANDARD:(sizeA===8?TEMPLATE_8_PERKEMI:TEMPLATE_16));
            poolConfigs.push({ name: 'A', template: tempA, size: sizeA, athletes: poolA, isCrossover: false });

            let sizeB = poolB.length <= 4 ? 4 : (poolB.length <= 8 ? 8 : 16);
            let tempB = mode === 'single' ? (sizeB===4?SINGLE_TEMPLATE_4:(sizeB===8?SINGLE_TEMPLATE_8:SINGLE_TEMPLATE_16)) : (sizeB===4?TEMPLATE_4_STANDARD:(sizeB===8?TEMPLATE_8_PERKEMI:TEMPLATE_16));
            poolConfigs.push({ name: 'B', template: tempB, size: sizeB, athletes: poolB, isCrossover: false });
            
        } else {
            return alert("Sistem saat ini mendukung maksimal 32 peserta per nomor.");
        }

        let globalMatchIdCounter = Date.now(); 
        poolConfigs.forEach((config, poolIndex) => {
            const slotsCount = config.size;
            const athleteCount = config.athletes.length;
            const byeCount = slotsCount - athleteCount;
            const totalMatchesR1 = slotsCount / 2;

            if(config.isCrossover && byeCount > 0) return alert("Template Crossover Final membutuhkan 4 peserta penuh (tanpa BYE).");

            const shuffledAthletes = [...config.athletes];
            
            // ATURAN KHUSUS: Jangan acak atlet jika nama kategori mengandung kata "FINAL"
            if (!isFinalCategory) {
                for (let i = shuffledAthletes.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    let temp = shuffledAthletes[i]; shuffledAthletes[i] = shuffledAthletes[j]; shuffledAthletes[j] = temp;
                }
            }

            let finalSlots = new Array(slotsCount).fill(null);

            if(byeCount === 0) {
                shuffledAthletes.forEach((p, idx) => finalSlots[idx] = p.id);
            } else {
                let athleteIds = shuffledAthletes.map(a => a.id);
                let oddSlots = [], evenSlots = [];
                for(let i=1; i<=slotsCount; i++) { if(i % 2 !== 0) oddSlots.push(i); else evenSlots.push(i); }
                if(byeCount > totalMatchesR1) return alert("Kesalahan Fatal: Jumlah BYE melebihi jumlah partai Babak 1.");

                let evenSlotsDistributed = [];
                const matchesPerQuarter = totalMatchesR1 / 4;
                
                if (matchesPerQuarter >= 1) {
                    const quartersEvenRaw = [
                        evenSlots.slice(0, matchesPerQuarter),
                        evenSlots.slice(matchesPerQuarter, matchesPerQuarter*2),
                        evenSlots.slice(matchesPerQuarter*2, matchesPerQuarter*3),
                        evenSlots.slice(matchesPerQuarter*3)
                    ];
                    for(let i=0; i<matchesPerQuarter; i++) {
                        [0, 2, 1, 3].forEach(qIdx => { evenSlotsDistributed.push(quartersEvenRaw[qIdx][i]); });
                    }
                } else {
                    evenSlotsDistributed = [...evenSlots];
                }

                for(let b=0; b<byeCount; b++) { finalSlots[evenSlotsDistributed[b]-1] = -1; }
                for(let o=0; o<totalMatchesR1; o++) { finalSlots[oddSlots[o]-1] = athleteIds.shift(); }
                const unfilledEvenIndices = evenSlotsDistributed.slice(byeCount).map(s => s - 1);
                unfilledEvenIndices.forEach(idx => { finalSlots[idx] = athleteIds.shift(); });
            }

            let numOffset = poolIndex * 50; 
            config.template.forEach(t => {
                let match = {
                    id: globalMatchIdCounter++,
                    kategori: catName, pool: config.name,
                    matchNum: t.matchNum + numOffset,
                    babak: t.babak, col: t.col,
                    nextW: typeof t.nextW === 'number' ? t.nextW + numOffset : t.nextW,
                    nextWSlot: t.nextWSlot || null,
                    nextL: typeof t.nextL === 'number' ? t.nextL + numOffset : t.nextL,
                    nextLSlot: t.nextLSlot || null,
                    merahId: t.slot1 !== null ? finalSlots[t.slot1 - 1] : null,
                    putihId: t.slot2 !== null ? finalSlots[t.slot2 - 1] : null,
                    winnerId: null, loserId: null, status: 'pending', skorMerah: 0, skorPutih: 0
                };
                STATE.matches.push(match);
            });
        });

        processAutoWins(catName); 
        saveToLocalStorage(); 
        renderVisualBracket(catName);
        setTimeout(() => alert(`Bagan berhasil di-generate!`), 300);
    } catch(err) { console.error(err); }
}

function resetNilaiKategoriLokal() {
    const catName = document.getElementById('draw-select-kategori').value;
    if(!catName) return alert("Pilih kategori terlebih dahulu.");
    const categoryObj = STATE.categories.find(c => c.name === catName);
    if(!categoryObj) return;

    if(!confirm(`⚠️ PERHATIAN!\nAnda akan MENGHAPUS SEMUA HASIL NILAI di kategori "${catName}".\n\nBagan atau Urutan Tampil TIDAK AKAN BERUBAH.\n\nApakah Anda yakin ingin mengosongkan nilai?`)) return;

    if(categoryObj.discipline === 'randori') {
        STATE.matches = STATE.matches.filter(m => !(m.kategori === catName && m.babak === "SUDDEN DEATH"));
        let catMatches = STATE.matches.filter(m => m.kategori === catName);
        catMatches.forEach(m => {
            if(m.col > 1) { m.merahId = null; m.putihId = null; }
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
    if(event) event.stopPropagation();
    let match = STATE.matches.find(m => m.id === matchId);
    if(!match) return;
    let hasStarted = STATE.matches.some(x => x.kategori === match.kategori && x.status === 'done');
    if(hasStarted) return alert("❌ PERINGATAN DIRECTOR:\nTidak bisa menukar posisi! Turnamen di kategori ini sudah berjalan.\n\nKosongkan seluruh nilai jika Anda harus menukar posisi.");
    if(!SWAP_SELECTION) {
        SWAP_SELECTION = { matchId, corner, participantId };
        renderVisualBracket(match.kategori); 
    } else {
        if(SWAP_SELECTION.matchId === matchId && SWAP_SELECTION.corner === corner) {
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
        if(m.col > 1) { m.merahId = null; m.putihId = null; }
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
        if(actualLoserId && actualLoserId !== -1) {
            let loserP = STATE.participants.find(p => p.id === actualLoserId);
            if (loserP) loserP.losses += 1;
        }
    });
    saveToLocalStorage();
}

function undoMatchResult(matchId) {
    let match = STATE.matches.find(m => m.id === matchId);
    if(!match || match.status !== 'done') return;

    if(!confirm(`⚠️ Batalkan hasil pertandingan G-${match.matchNum % 50 === 0 ? 50 : match.matchNum % 50}?`)) return;

    let nextWMatch = STATE.matches.find(m => m.kategori === match.kategori && m.matchNum === match.nextW && m.pool === match.pool);
    let nextLMatch = STATE.matches.find(m => m.kategori === match.kategori && m.matchNum === match.nextL && m.pool === match.pool);

    if(nextWMatch && nextWMatch.status !== 'pending' && nextWMatch.status !== 'auto-win') { return alert("❌ UNDO DITOLAK:\nPartai lanjutan dari pemenang sudah terlanjur dimainkan."); }
    if(nextLMatch && nextLMatch.status !== 'pending' && nextLMatch.status !== 'auto-win') { return alert("❌ UNDO DITOLAK:\nPartai lanjutan dari yang kalah sudah terlanjur dimainkan."); }

    if(nextWMatch) {
        if(nextWMatch.merahId === match.winnerId) nextWMatch.merahId = null;
        if(nextWMatch.putihId === match.winnerId) nextWMatch.putihId = null;
    }
    
    let loserId = match.loserId;
    if (!loserId) { loserId = (match.winnerId === match.merahId) ? match.putihId : match.merahId; }
    
    if(nextLMatch && loserId) {
        if(nextLMatch.merahId === loserId) nextLMatch.merahId = null;
        if(nextLMatch.putihId === loserId) nextLMatch.putihId = null;
    }

    if(match.nextW === 'WINNER') {
        STATE.matches = STATE.matches.filter(m => !(m.kategori === match.kategori && m.pool === match.pool && m.babak === "SUDDEN DEATH"));
    }

    match.status = 'pending'; match.winnerId = null; match.loserId = null; match.skorMerah = 0; match.skorPutih = 0;
    
    recalculateAllLosses(match.kategori);
    processAutoWins(match.kategori);
    
    // --- STRATEGI B: BRANCH UPDATE ---
    let updates = {};
    updates['turnamen_data/matches'] = STATE.matches;
    updates['turnamen_data/participants'] = STATE.participants;
    
    database.ref().update(updates).then(() => {
        renderVisualBracket(match.kategori); filterPesertaScoring();
    }).catch(err => alert("Gagal Undo: " + err));
}

function forwardParticipant(targetMatchNum, participantId, catName, poolName, targetSlot = null) {
    if(!targetMatchNum || targetMatchNum === 'WINNER' || targetMatchNum === 'SECOND' || participantId == null) return;
    let targetMatch = STATE.matches.find(m => m.kategori === catName && m.matchNum === targetMatchNum && m.pool === poolName);
    if(targetMatch) {
        if(participantId !== -1 && (targetMatch.merahId === participantId || targetMatch.putihId === participantId)) return; 
        
        // Memaksa atlet masuk ke Pita Merah (1) atau Putih (2)
        if (targetSlot === 1) targetMatch.merahId = participantId;
        else if (targetSlot === 2) targetMatch.putihId = participantId;
        else {
            if(targetMatch.merahId == null) targetMatch.merahId = participantId;
            else if(targetMatch.putihId == null) targetMatch.putihId = participantId;
        }
    }
}

function processAutoWins(catName) {
    let changed = true; let loopGuard = 0;
    while(changed && loopGuard < 100) {
        changed = false; loopGuard++;
        STATE.matches.filter(m => m.kategori === catName && m.status === 'pending').forEach(match => {
            if(match.merahId != null && match.putihId != null) {
                if(match.merahId === -1 || match.putihId === -1) {
                    match.status = 'auto-win';
                    if(match.merahId === -1 && match.putihId === -1) { match.winnerId = -1; match.loserId = -1; } 
                    else { match.winnerId = match.merahId === -1 ? match.putihId : match.merahId; match.loserId = -1; }
                    
                    forwardParticipant(match.nextW, match.winnerId, catName, match.pool, match.nextWSlot);
                    if(match.nextL) forwardParticipant(match.nextL, match.loserId, catName, match.pool, match.nextLSlot);
                    changed = true; 
                }
            }
        });
    }
    recalculateAllLosses(catName);
}

function renderVisualBracket(catName) {
    const container = document.getElementById('randori-bracket-view');
    const wrapper = document.getElementById('randori-bracket-container');
    
    try {
        wrapper.classList.remove('hidden'); container.innerHTML = ''; 
        const catMatches = STATE.matches.filter(m => m.kategori === catName);
        if(catMatches.length === 0) return;

        let pools = []; catMatches.forEach(m => { if(pools.indexOf(m.pool) === -1) pools.push(m.pool); });
        
        pools.forEach(poolName => {
            let poolMatches = catMatches.filter(m => m.pool === poolName);
            
            let poolHTML = `<div class="mb-10 w-full min-w-max">
                <div class="flex items-center gap-3 mb-4 border-b border-slate-700 pb-2">
                    <h3 class="text-xl font-black text-yellow-400 m-0">BAGAN ${poolName !== '-' ? 'POOL ' + poolName : 'UTAMA'}</h3>
                    <span class="text-[10px] text-slate-500 font-mono ml-2 border-l border-slate-700 pl-3">Swap: Klik Nama | Undo: Klik <i class="fas fa-undo text-red-400 mx-1"></i></span>
                    <button onclick="resetNilaiKategoriLokal()" class="ml-auto bg-red-900/50 border border-red-700 text-red-400 hover:bg-red-500 hover:text-white w-7 h-7 rounded flex items-center justify-center transition-colors" title="Kosongkan Nilai Saja (Bagan Tetap)">
                        <i class="fas fa-eraser text-xs"></i>
                    </button>
                </div>
                <div class="flex gap-8 pb-4">`;
            
            let columns = [];
            poolMatches.forEach(m => { if(columns.indexOf(m.col) === -1) columns.push(m.col); });
            columns.sort((a,b) => a-b);
            let maxCol = columns[columns.length - 1];

            columns.forEach(colNum => {
                let colMatches = poolMatches.filter(m => m.col === colNum).sort((a,b) => a.matchNum - b.matchNum);
                if(colMatches.length === 0) return;

                let colHTML = `<div class="flex flex-col gap-6 justify-center min-w-[240px]">`;
                colHTML += `<h4 class="text-center text-xs font-bold uppercase text-slate-500 mb-2">Babak ${colNum}</h4>`;
                
                colMatches.forEach(m => {
                    let displayNum = m.matchNum % 50 === 0 ? 50 : m.matchNum % 50; 
                    let pMerah = STATE.participants.find(p => p.id === m.merahId);
                    let nMerahRaw = m.merahId === -1 ? "BYE" : (pMerah ? pMerah.nama : (m.merahId ? "Hantu" : "Menunggu..."));
                    let pPutih = STATE.participants.find(p => p.id === m.putihId);
                    let nPutihRaw = m.putihId === -1 ? "BYE" : (pPutih ? pPutih.nama : (m.putihId ? "Hantu" : "Menunggu..."));
                    
                    let bgStyle = m.status === 'done' ? 'border-green-500 bg-slate-800' : m.status === 'auto-win' ? 'border-slate-600 bg-slate-900 opacity-50' : 'border-blue-500 bg-slate-800';
                    let wMerah = m.winnerId === m.merahId ? 'text-green-400' : m.winnerId && m.winnerId !== m.merahId ? 'text-slate-500 line-through' : 'text-red-400';
                    let wPutih = m.winnerId === m.putihId ? 'text-green-400' : m.winnerId && m.winnerId !== m.putihId ? 'text-slate-500 line-through' : 'text-white';

                    let isInteractive = (m.col === 1 && m.status === 'pending');
                    let activeM = (SWAP_SELECTION && SWAP_SELECTION.matchId === m.id && SWAP_SELECTION.corner === 'merah') ? 'bg-yellow-600/80 px-1 rounded text-white shadow-[0_0_10px_rgba(234,179,8,0.5)]' : '';
                    let activeP = (SWAP_SELECTION && SWAP_SELECTION.matchId === m.id && SWAP_SELECTION.corner === 'putih') ? 'bg-yellow-600/80 px-1 rounded text-white shadow-[0_0_10px_rgba(234,179,8,0.5)]' : '';
                    let cursorM = isInteractive ? `cursor-pointer hover:text-yellow-400 border-b border-dashed border-slate-500 ${activeM}` : '';
                    let cursorP = isInteractive ? `cursor-pointer hover:text-yellow-400 border-b border-dashed border-slate-500 ${activeP}` : '';
                    
                    let nMerahHTML = `<span class="${wMerah} truncate w-32 ${cursorM}" ${isInteractive ? `onclick="handleSwap(${m.id}, 'merah', ${m.merahId}, event)" title="Klik untuk Tukar"` : ''}>${nMerahRaw}</span>`;
                    let nPutihHTML = `<span class="${wPutih} truncate w-32 ${cursorP}" ${isInteractive ? `onclick="handleSwap(${m.id}, 'putih', ${m.putihId}, event)" title="Klik untuk Tukar"` : ''}>${nPutihRaw}</span>`;

                    let undoBtn = m.status === 'done' ? `<button onclick="undoMatchResult(${m.id})" class="absolute -bottom-2 -right-2 bg-red-600 hover:bg-red-500 text-white text-[10px] w-7 h-7 rounded-full shadow-lg border border-slate-800 z-10 flex items-center justify-center transition-transform hover:scale-110" title="Batalkan Hasil Partai Ini"><i class="fas fa-undo"></i></button>` : '';

                    colHTML += `
                        <div class="bracket-match p-3 rounded-lg border-2 ${bgStyle} relative shadow-lg transition-all">
                            <span class="absolute -top-3 -left-3 bg-slate-700 text-[10px] w-6 h-6 flex items-center justify-center rounded-full font-black border border-slate-500">G${displayNum}</span>
                            ${undoBtn}
                            <span class="text-[9px] uppercase text-slate-400 block mb-2 font-bold">${m.babak}</span>
                            <div class="flex justify-between items-center text-sm font-bold border-b border-slate-700 pb-1 mb-1">
                                ${nMerahHTML}
                                <span class="text-xs text-slate-500">${m.skorMerah > 0 ? m.skorMerah : ''}</span>
                            </div>
                            <div class="flex justify-between items-center text-sm font-bold">
                                ${nPutihHTML}
                                <span class="text-xs text-slate-500">${m.skorPutih > 0 ? m.skorPutih : ''}</span>
                            </div>
                        </div>
                    `;
                });
                colHTML += `</div>`;
                if(colNum < maxCol) colHTML += `<div class="flex flex-col justify-center"><div class="w-8 border-b-2 border-slate-600"></div></div>`;
                poolHTML += colHTML;
            });
            poolHTML += `</div></div>`;
            container.innerHTML += poolHTML;
        });
    } catch (err) { console.error(err); }
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
        let borderColor = pool.isFinal ? 'border-yellow-600' : 'border-slate-600'; 
        let titleColor = pool.isFinal ? 'text-yellow-500' : 'text-purple-400'; 
        html += `<div class="bg-slate-800 p-4 md:p-5 rounded-xl border ${borderColor} shadow-sm w-full h-full flex flex-col">
            <h3 class="font-black text-center ${titleColor} mb-4 border-b border-slate-700 pb-3">${pool.title}</h3>
            <div class="space-y-3 flex-1">`; 
        pool.data.forEach((p) => { 
            let noUrut = pool.isFinal ? p.urutFinal : p.urut; 
            
            // --- SENSOR KLIK & WARNA HIGHLIGHT EMBU ---
            let isSelected = (EMBU_SWAP_SELECTION === p.id);
            let activeClass = isSelected 
                ? 'bg-yellow-600/40 border-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.3)]' 
                : 'bg-slate-900/50 border-slate-700/50 hover:bg-slate-700/40';

            html += `<div onclick="handleEmbuSwap(${p.id})" class="cursor-pointer flex flex-col xl:flex-row items-start xl:items-center justify-between text-sm p-3 rounded-lg border gap-3 transition-all duration-200 ${activeClass}">
                <div class="flex gap-3 items-start w-full">
                    <span class="font-mono ${isSelected ? 'text-yellow-400' : 'text-slate-500'} w-5 text-right flex-shrink-0 pt-0.5">${noUrut}.</span>
                    <span class="font-bold ${isSelected ? 'text-yellow-400' : 'text-white'} whitespace-normal break-words leading-snug">${p.nama}</span>
                </div>
                <div class="flex justify-start xl:justify-end w-full xl:w-auto pl-8 xl:pl-0">
                    <span class="text-[10px] ${isSelected ? 'text-yellow-200 bg-yellow-900/50 border-yellow-600' : 'text-slate-400 bg-slate-800 border-slate-700'} px-2 py-1 rounded border whitespace-nowrap shadow-sm">${p.kontingen}</span>
                </div>
            </div>`; 
            // ------------------------------------------

        }); 
        html += `</div></div>`;
    });
    html += `</div></div>`;
    container.innerHTML = html;
}
// INJEKSI DOM UNTUK TOMBOL UNDUH JADWAL (MIKRO)
function checkExistingDrawing() {
    const catName = document.getElementById('draw-select-kategori').value; 
    const panelEmbu = document.getElementById('draw-panel-embu'); const panelRandori = document.getElementById('draw-panel-randori'); const panelEmpty = document.getElementById('draw-panel-empty'); const resultDiv = document.getElementById('drawing-result'); 
    panelEmbu.classList.add('hidden'); panelRandori.classList.add('hidden'); panelEmpty.classList.add('hidden'); resultDiv.innerHTML = ''; document.getElementById('randori-bracket-container').classList.add('hidden');
    
    // Injeksi Tombol Unduh Jadwal
    let drawHeader = document.querySelector('#section-drawing > div:first-child');
    let microDrawBtn = document.getElementById('btn-micro-draw-export');
    if (!microDrawBtn && drawHeader) {
        microDrawBtn = document.createElement('button');
        microDrawBtn.id = 'btn-micro-draw-export';
        microDrawBtn.className = 'w-full md:w-auto bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors text-sm flex items-center justify-center gap-2 mt-4 md:mt-0';
        microDrawBtn.innerHTML = '<i class="fas fa-file-csv"></i> UNDUH JADWAL';
        microDrawBtn.onclick = () => exportDrawingCSV(document.getElementById('draw-select-kategori').value);
        drawHeader.appendChild(microDrawBtn);
    }
    
    if(!catName) { 
        panelEmpty.classList.remove('hidden'); 
        if(microDrawBtn) microDrawBtn.classList.add('hidden');
        return; 
    }
    
    if(microDrawBtn) microDrawBtn.classList.remove('hidden');
    
    const categoryObj = STATE.categories.find(c => c.name === catName); let list = STATE.participants.filter(p => p.kategori === catName); 
    
    if(categoryObj && categoryObj.discipline === 'randori') { 
        panelRandori.classList.remove('hidden'); 
        renderVisualBracket(catName); 
    } else { 
        panelEmbu.classList.remove('hidden'); 
        const isFinalMode = list.some(p => p.isFinalist); 
        if (isFinalMode) { 
            let finalL = list.filter(p => p.isFinalist); 
            if (finalL.some(p => p.urutFinal > 0)) { 
                finalL.sort((a,b) => a.urutFinal - b.urutFinal); 
                renderEmbuLayout(catName, resultDiv, [{data: finalL, title: "POOL FINAL", isFinal: true}]);
            } else { 
                resultDiv.innerHTML = `<div class="col-span-full text-center text-yellow-500 py-10 border-2 border-dashed border-yellow-600 rounded-xl">Peserta Final dipilih. Klik Acak Urutan.</div>`; 
            } 
        } else if (list.some(p => p.urut > 0)) { 
            list.sort((a,b) => a.urut - b.urut); 
            if(list.some(p => p.pool === 'A' || p.pool === 'B')) { 
                renderEmbuLayout(catName, resultDiv, [ {data: list.filter(p => p.pool === 'A'), title: "POOL A", isFinal: false}, {data: list.filter(p => p.pool === 'B'), title: "POOL B", isFinal: false} ]);
            } else { 
                renderEmbuLayout(catName, resultDiv, [{data: list, title: "BABAK PENYISIHAN", isFinal: false}]);
            } 
        } else { 
            resultDiv.innerHTML = `<div class="col-span-full text-center text-slate-500 py-10 border-2 border-dashed border-slate-700 rounded-xl">Belum diundi.</div>`; 
        } 
    }
}

function startDrawing() { 
    const catName = document.getElementById('draw-select-kategori').value; 
    if(!catName) return alert("Pilih kategori!"); 
    let list = STATE.participants.filter(p => p.kategori === catName); 
    if(list.length === 0) return alert("Belum ada peserta!"); 
    
    const isFinalMode = list.some(p => p.isFinalist); 
    if (isFinalMode) { 
        let finalL = list.filter(p => p.isFinalist); 
        if (finalL.some(p => p.urutFinal > 0)) if (!confirm("⚠️ Finalis SUDAH DIUNDI.\nYakin ingin mengacak ulang?")) return; 
        shuffleArray(finalL); 
        finalL.forEach((p, index) => { const idx = STATE.participants.findIndex(x => x.id === p.id); STATE.participants[idx].urutFinal = index + 1; }); 
    } else { 
        if (list.some(p => p.urut > 0)) { 
            if (!confirm("⚠️ Kategori ini SUDAH DIUNDI.\nYakin ingin mengacak ulang?")) return; 
            list.forEach(p => { p.scores = { b1: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time:0 }, b2: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time:0 } }; p.finalScore = 0; p.techScore = 0; }); 
        } 
        shuffleArray(list); 
        if (list.length > 6) { 
            const half = Math.ceil(list.length / 2); 
            const poolA = list.slice(0, half); 
            const poolB = list.slice(half); 
            applyDrawingData(poolA, 'A'); applyDrawingData(poolB, 'B'); 
        } else { 
            applyDrawingData(list, 'SINGLE'); 
        } 
    } 
    saveToLocalStorage(); checkExistingDrawing(); renderParticipantTable(); 
}

function shuffleArray(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } }
function applyDrawingData(arr, poolName) { arr.forEach((p, index) => { const found = STATE.participants.find(item => item.id === p.id); if(found) { found.urut = index + 1; found.pool = poolName; }}); }

function filterPesertaScoring() {
    const catName = document.getElementById('select-kategori').value;
    const categoryObj = STATE.categories.find(c => c.name === catName);
    const panelEmbu = document.getElementById('panel-embu'); 
    const panelRandori = document.getElementById('panel-randori');
    const badgeEmbu = document.getElementById('scoring-badge-embu'); 
    const badgeRandori = document.getElementById('scoring-badge-randori');
    const panelWaktu = document.getElementById('panel-waktu-embu'); 
    const selectEl = document.getElementById('select-peserta');
    
    if(!categoryObj) return;

    // SIMPAN MEMORI: Ingat partai apa yang sedang dinilai saat ini
    const currentSelectedMatchOrAthlete = selectEl.value; 

    if(categoryObj.discipline === 'randori') {
        panelEmbu.classList.add('hidden'); panelRandori.classList.remove('hidden'); 
        badgeEmbu.classList.add('hidden'); badgeRandori.classList.remove('hidden');
        if(panelWaktu) panelWaktu.classList.add('hidden'); 
        
        let catMatches = STATE.matches.filter(m => 
            m.kategori === catName && 
            m.status === 'pending' && 
            m.merahId != null && m.putihId != null && 
            m.merahId !== -1 && m.putihId !== -1
        );

        if(catMatches.length === 0) { 
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

        selectEl.innerHTML = catMatches.sort((a,b)=>a.matchNum - b.matchNum).map((m) => {
            const mrh = STATE.participants.find(p => p.id === m.merahId) || { nama: "Menunggu..." }; 
            const pth = STATE.participants.find(p => p.id === m.putihId) || { nama: "Menunggu..." };
            let displayNum = m.matchNum % 50 === 0 ? 50 : m.matchNum % 50;
            let pLabel = m.pool !== '-' ? `Pool ${m.pool}` : 'Utama';
            return `<option value="match-${m.id}">G-${displayNum} [${pLabel}] [${m.babak}] ${mrh.nama} vs ${pth.nama}</option>`;
        }).join('');

        // LOGIKA ANTI-STUCK: Pindahkan pilihan secara manual, bukan via event
        let stillExists = Array.from(selectEl.options).some(opt => opt.value === currentSelectedMatchOrAthlete);
        
        if (stillExists) {
            selectEl.value = currentSelectedMatchOrAthlete;
        } else {
            // Jika partai hilang (karena sudah di-save), paksa browser pilih opsi pertama dan muat langsung
            if (selectEl.options.length > 0) {
                selectEl.value = selectEl.options[0].value;
                document.getElementById('scoring-athlete-name').innerText = selectEl.options[0].text;
                loadRandoriMatch(); 
            }
        }

    } else {
        // --- BAGIAN EMBU ---
        panelEmbu.classList.remove('hidden'); panelRandori.classList.add('hidden'); 
        badgeEmbu.classList.remove('hidden'); badgeRandori.classList.add('hidden');
        if(panelWaktu) panelWaktu.classList.remove('hidden'); 
        
        let listCat = STATE.participants.filter(p => p.kategori === catName && p.urut > 0); const hasFinal = listCat.some(p => p.isFinalist);
        let filtered = hasFinal ? listCat.filter(p => p.isFinalist).sort((a,b) => a.urutFinal - b.urutFinal) : listCat.sort((a,b) => a.pool.localeCompare(b.pool) || a.urut - b.urut);
        
        if(filtered.length === 0) { 
            selectEl.innerHTML = `<option value="">-- Kosong / Belum Undian --</option>`; 
            document.getElementById('scoring-athlete-name').innerText = "-"; 
            updateScoringButtonsUI(); 
            return; 
        }
        
        selectEl.innerHTML = filtered.map(p => { 
            let label = hasFinal ? `[FINAL] No.${p.urutFinal}` : `[Pool ${p.pool}] No.${p.urut}`; 
            return `<option value="${p.id}">${label} - ${p.nama} (${p.kontingen})</option>`; 
        }).join('');
        
        let stillExists = Array.from(selectEl.options).some(opt => opt.value === currentSelectedMatchOrAthlete);
        if(stillExists) {
            selectEl.value = currentSelectedMatchOrAthlete;
        } else {
            if (selectEl.options.length > 0) {
                selectEl.value = selectEl.options[0].value;
                document.getElementById('scoring-athlete-name').innerText = selectEl.options[0].text;
                updateScoringButtonsUI();
            }
        }
    }
}

let currentRandoriMatchId = null;
function loadRandoriMatch() {
    const val = document.getElementById('select-peserta').value; 
    if(!val || !val.startsWith('match-')) return;
    
    const newMatchId = parseInt(val.replace('match-', '')); 
    
    // KUNCI PENGAMAN: Cegah reset skor jika match yang dimuat masih sama!
    if (currentRandoriMatchId === newMatchId) return; 

    currentRandoriMatchId = newMatchId; 
    const match = STATE.matches.find(m => m.id === currentRandoriMatchId); 
    if(!match) return;

    const merah = STATE.participants.find(p => p.id === match.merahId); 
    const putih = STATE.participants.find(p => p.id === match.putihId);
    document.getElementById('randori-nama-merah').innerText = merah ? merah.nama : "-"; 
    document.getElementById('randori-kont-merah').innerText = merah ? merah.kontingen : "-";
    document.getElementById('randori-nama-putih').innerText = putih ? putih.nama : "-"; 
    document.getElementById('randori-kont-putih').innerText = putih ? putih.kontingen : "-";
    
    resetRandoriBoard(); 
}

function resetRandoriBoard() { RANDORI_STATE = { merah: { score: 0 }, putih: { score: 0 } }; updateRandoriUI(); }
function addRandoriScore(corner, points) { RANDORI_STATE[corner].score += points; if(RANDORI_STATE[corner].score < 0) RANDORI_STATE[corner].score = 0; updateRandoriUI(); }
function updateRandoriUI() { document.getElementById('score-merah').innerText = RANDORI_STATE.merah.score; document.getElementById('score-putih').innerText = RANDORI_STATE.putih.score; }

function saveRandoriMatchResult() {
    if(!currentRandoriMatchId) return alert("Pilih partai!");
    const match = STATE.matches.find(m => m.id === currentRandoriMatchId);
    if(!match) return;

    let sMerah = RANDORI_STATE.merah.score; let sPutih = RANDORI_STATE.putih.score;
    if(sMerah === sPutih) return alert("Skor seri! Tambahkan poin kemenangan.");

    let winnerId = sMerah > sPutih ? match.merahId : match.putihId;
    let loserId = sMerah > sPutih ? match.putihId : match.merahId;
    let winnerName = sMerah > sPutih ? "PITA MERAH" : "PITA PUTIH";

    if(confirm(`Konfirmasi Pemenang: ${winnerName}\nSkor: ${sMerah} - ${sPutih}\n\nLanjutkan?`)) {
        match.skorMerah = sMerah; match.skorPutih = sPutih; 
        match.winnerId = winnerId; match.loserId = loserId; 
        match.status = 'done';
        
        recalculateAllLosses(match.kategori);
        let winnerP = STATE.participants.find(p => p.id === winnerId);
        let isGrandFinal = match.nextW === 'WINNER' && match.babak !== "SUDDEN DEATH";
        let isChallenger = winnerP && winnerP.losses > 0;
        
        let mode = (STATE.settings && STATE.settings.tournamentMode) ? STATE.settings.tournamentMode : 'double';
        if(mode === 'double' && isGrandFinal && isChallenger) {
            alert("TIE BREAKER GRAND FINAL!\nSistem membuka Partai Sudden Death!");
            STATE.matches = STATE.matches.filter(m => !(m.kategori === match.kategori && m.pool === match.pool && m.babak === "SUDDEN DEATH"));
            
            // --- POSISI DITUKAR DI SINI (merahId diisi putihId lama, putihId diisi merahId lama) ---
            STATE.matches.push({ id: Date.now(), kategori: match.kategori, pool: match.pool, matchNum: match.matchNum + 1, babak: "SUDDEN DEATH", col: match.col + 1, nextW: 'WINNER', nextL: 'SECOND', merahId: match.putihId, putihId: match.merahId, winnerId: null, status: 'pending', skorMerah: 0, skorPutih: 0 });
            
        } else {
            forwardParticipant(match.nextW, winnerId, match.kategori, match.pool, match.nextWSlot); 
            if(match.nextL) forwardParticipant(match.nextL, loserId, match.kategori, match.pool, match.nextLSlot); 
        }

        processAutoWins(match.kategori); 
        
        // --- STRATEGI B: BRANCH UPDATE ---
        // Menembak spesifik ke cabang data, menghemat ukuran payload
        let updates = {};
        updates['turnamen_data/matches'] = STATE.matches;
        updates['turnamen_data/participants'] = STATE.participants;
        
        database.ref().update(updates).then(() => {
            alert("Partai Selesai! Pemenang dicatat."); 
            filterPesertaScoring(); checkExistingDrawing();
        }).catch(err => alert("Gagal Simpan: " + err));
    }
}

document.getElementById('select-peserta').addEventListener('change', (e) => { 
    if(e.target.selectedIndex >= 0) { 
        // Ubah judul nama atlet di atas
        document.getElementById('scoring-athlete-name').innerText = e.target.options[e.target.selectedIndex].text; 
        
        if(e.target.value.startsWith('match-')) {
            // LANJUT OTOMATIS: Jika ini Randori dan partai belum habis, langsung muat data partai selanjutnya
            loadRandoriMatch(); 
        } else { 
            // TUTUP OTOMATIS: Jika partai Randori sudah habis, bersihkan papan skor sepenuhnya
            document.getElementById('randori-nama-merah').innerText = "-"; 
            document.getElementById('randori-kont-merah').innerText = "-";
            document.getElementById('randori-nama-putih').innerText = "-"; 
            document.getElementById('randori-kont-putih').innerText = "-";
            currentRandoriMatchId = null;
            resetRandoriBoard(); 
            
            // JALUR EMBU: Embu tidak terpengaruh oleh pembersihan di atas dan akan tetap terbuka/bisa diedit
            updateScoringButtonsUI(); 
        }
    }
});
document.getElementById('select-kategori').addEventListener('change', filterPesertaScoring);

function updateScoringButtonsUI() { const pId = parseInt(document.getElementById('select-peserta').value); const selectBabak = document.getElementById('select-babak'); const btnB1 = document.getElementById('btn-save-b1'); const btnB2 = document.getElementById('btn-save-b2'); const btnPen = document.getElementById('btn-save-penyisihan'); const btnFin = document.getElementById('btn-save-final'); if(!pId || !selectBabak || !btnB1) return; const p = STATE.participants.find(i => i.id === pId); selectBabak.innerHTML = ''; const isFinalMode = STATE.participants.some(x => x.kategori === p.kategori && x.isFinalist); if(isFinalMode && p.isFinalist) selectBabak.innerHTML = `<option value="b2">Babak Final</option>`; else if(p.pool === 'A' || p.pool === 'B') selectBabak.innerHTML = `<option value="b1">Babak Penyisihan</option>`; else selectBabak.innerHTML = `<option value="b1">Babak 1</option><option value="b2">Babak 2</option>`; btnB1.classList.add('hidden'); btnB2.classList.add('hidden'); btnPen.classList.add('hidden'); btnFin.classList.add('hidden'); if(isFinalMode && p.isFinalist) btnFin.classList.remove('hidden'); else if(p.pool === 'A' || p.pool === 'B') btnPen.classList.remove('hidden'); else { btnB1.classList.remove('hidden'); btnB2.classList.remove('hidden'); } loadExistingScores(); }
function setJudges(n) { STATE.settings.numJudges = n; document.getElementById('btn-j3').className = n === 3 ? 'px-4 py-1.5 rounded font-bold text-sm bg-blue-600 text-white' : 'px-4 py-1.5 rounded font-semibold text-sm text-slate-400 hover:text-white'; document.getElementById('btn-j5').className = n === 5 ? 'px-4 py-1.5 rounded font-bold text-sm bg-blue-600 text-white' : 'px-4 py-1.5 rounded font-semibold text-sm text-slate-400 hover:text-white'; const container = document.getElementById('judge-inputs'); container.innerHTML = ''; for(let i=1; i<=n; i++) { container.innerHTML += `<div class="bg-slate-900 p-3 rounded-lg border border-slate-600 focus-within:border-blue-500 transition-colors"><div class="text-center mb-2 pb-2 border-b border-slate-700"><label class="block text-[10px] text-slate-400 uppercase font-bold">Wasit ${i}</label></div><div class="space-y-2"><div><label class="block text-[9px] text-slate-500 mb-1">TOTAL NILAI</label><input type="number" step="0.5" id="score-${i}" oninput="calculateLive()" class="w-full bg-slate-800 p-2 rounded text-2xl font-black outline-none text-center text-white placeholder-slate-700" placeholder="0"></div><div><label class="block text-[9px] text-slate-500 mb-1 flex justify-between"><span>TEKNIK</span> ${i===1?'<span class="text-yellow-500 font-bold">TIE-BREAK</span>':''}</label><input type="number" step="0.5" id="tech-${i}" oninput="calculateLive()" class="w-full bg-slate-800 p-2 rounded text-sm font-bold outline-none text-center ${i===1?'text-yellow-400':'text-blue-300'} placeholder-slate-700" placeholder="Opsional"></div></div></div>`; } calculateLive(); }
function loadExistingScores() { const pId = parseInt(document.getElementById('select-peserta').value); const babak = document.getElementById('select-babak').value; if(!pId || !babak) return; const p = STATE.participants.find(i => i.id === pId); const scoreData = p.scores[babak]; if(scoreData && scoreData.raw && scoreData.raw.length > 0) { const nJudges = scoreData.raw.length; if(STATE.settings.numJudges !== nJudges) setJudges(nJudges); for(let i=1; i<=nJudges; i++) { let sEl = document.getElementById(`score-${i}`); let tEl = document.getElementById(`tech-${i}`); if(sEl) sEl.value = scoreData.raw[i-1] || ''; if(tEl) tEl.value = (scoreData.techRaw && scoreData.techRaw[i-1]) ? scoreData.techRaw[i-1] : ''; } UI.timerSeconds = scoreData.time || 0; updateTimerUI(); } else { for(let i=1; i<=STATE.settings.numJudges; i++) { let sEl = document.getElementById(`score-${i}`); let tEl = document.getElementById(`tech-${i}`); if(sEl) sEl.value = ''; if(tEl) tEl.value = ''; } UI.timerSeconds = 0; updateTimerUI(); } calculateLive(); }

function calculateLive() { 
    let raw = []; let techRaw = []; 
    for(let i=1; i<=STATE.settings.numJudges; i++) { 
        let sEl = document.getElementById(`score-${i}`); let tEl = document.getElementById(`tech-${i}`);
        raw.push(sEl ? (parseFloat(sEl.value) || 0) : 0); techRaw.push(tEl ? (parseFloat(tEl.value) || 0) : 0); 
    } 
    let sum = 0; 
    if(STATE.settings.numJudges === 5) { let sorted = [...raw].sort((a,b) => a-b); sorted.pop(); sorted.shift(); sum = sorted.reduce((a,b) => a+b, 0); } 
    else { sum = raw.reduce((a,b) => a+b, 0); } 
    
    let minEl = document.getElementById('min-time'); let maxEl = document.getElementById('max-time');
    const minT = minEl ? (parseInt(minEl.value) || 0) : 0; const maxT = maxEl ? (parseInt(maxEl.value) || 0) : 0; 
    
    let penalty = 0; 
    if(UI.timerSeconds > 0 && minT > 0 && UI.timerSeconds < minT) { penalty = Math.ceil((minT - UI.timerSeconds) / 5) * 5; } 
    else if (maxT > 0 && UI.timerSeconds > maxT) { penalty = Math.ceil((UI.timerSeconds - maxT) / 5) * 5; }
    
    const final = Math.max(0, sum - penalty); 
    let finalEl = document.getElementById('live-final-score'); if(finalEl) finalEl.innerText = final.toFixed(1); 
    let penEl = document.getElementById('live-penalty'); if(penEl) penEl.innerText = penalty > 0 ? `Penalti Waktu: -${penalty}` : `Penalti Waktu: 0`; 
    return { final, penalty, raw, techRaw, tieBreaker: techRaw[0] }; 
}

function saveScore(babakOverride) { 
    const pId = parseInt(document.getElementById('select-peserta').value); if(!pId) return alert('Pilih atlet!'); 
    let babak = document.getElementById('select-babak').value; if(babakOverride === 1 || babakOverride === 2) babak = `b${babakOverride}`; 
    for(let i=1; i<=STATE.settings.numJudges; i++) { let sEl = document.getElementById(`score-${i}`); if(sEl && sEl.value === "") return alert(`TOTAL NILAI Wasit ${i} kosong!`); }
        
    const calc = calculateLive(); 
    const pIndex = STATE.participants.findIndex(i => i.id === pId); 
    const p = STATE.participants[pIndex]; 
    
    p.scores[babak] = { raw: calc.raw, techRaw: calc.techRaw, penalty: calc.penalty, final: calc.final, tech: calc.tieBreaker, time: UI.timerSeconds }; 
    
    if (p.isFinalist) { p.finalScore = p.scores.b2.final; p.techScore = p.scores.b2.tech; } 
    else if (p.pool === 'A' || p.pool === 'B') { p.finalScore = p.scores.b1.final; p.techScore = p.scores.b1.tech; } 
    else { 
        if(p.scores.b1.final > 0 && p.scores.b2.final > 0) { p.finalScore = (p.scores.b1.final + p.scores.b2.final) / 2; p.techScore = (p.scores.b1.tech + p.scores.b2.tech) / 2; } 
        else { p.finalScore = p.scores[babak].final; p.techScore = p.scores[babak].tech; } 
    } 
    
    // --- STRATEGI B: GRANULAR UPDATE (SUPER CEPAT) ---
    // Hanya mengirim data pIndex (1 Atlet) ke server. Bebas tabrakan data antar matras!
    let updates = {};
    updates[`turnamen_data/participants/${pIndex}`] = p;
    
    database.ref().update(updates).then(() => {
        alert(`SKOR TERSIMPAN!`); 
        clearInterval(UI.timerInterval); UI.timerInterval = null; 
        document.getElementById('btn-timer').innerText = 'START'; document.getElementById('btn-timer').className = 'bg-green-600 hover:bg-green-500 px-4 py-2 rounded-lg w-full font-bold'; 
    }).catch(err => alert("Gagal Simpan: " + err));
}

function toggleTimer() { const btn = document.getElementById('btn-timer'); if(UI.timerInterval) { clearInterval(UI.timerInterval); UI.timerInterval = null; btn.innerText = 'LANJUTKAN'; btn.classList.replace('bg-red-600', 'bg-yellow-600'); btn.classList.replace('hover:bg-red-500', 'hover:bg-yellow-500'); } else { UI.timerInterval = setInterval(() => { UI.timerSeconds++; updateTimerUI(); calculateLive(); }, 1000); btn.innerText = 'STOP'; btn.className = 'bg-red-600 hover:bg-red-500 px-4 py-2 rounded-lg w-full font-bold'; } }
function resetTimer() { clearInterval(UI.timerInterval); UI.timerInterval = null; UI.timerSeconds = 0; updateTimerUI(); document.getElementById('btn-timer').innerText = 'START'; document.getElementById('btn-timer').className = 'bg-green-600 hover:bg-green-500 px-4 py-2 rounded-lg w-full font-bold'; calculateLive(); }
function updateTimerUI() { document.getElementById('timer-display').innerText = `${Math.floor(UI.timerSeconds / 60).toString().padStart(2, '0')}:${(UI.timerSeconds % 60).toString().padStart(2, '0')}`; }

function calculateRandoriFinalists(catName) {
    let catMatches = STATE.matches.filter(m => m.kategori === catName);
    let pools = [...new Set(catMatches.map(m => m.pool))];
    let results = [];

    pools.forEach(poolName => {
        let poolMatches = catMatches.filter(m => m.pool === poolName);
        let grandFinals = poolMatches.filter(m => m.nextW === 'WINNER').sort((a,b) => b.id - a.id);
        
        if(grandFinals.length === 0 || grandFinals[0].status !== 'done') return;
        
        let gf = grandFinals[0];
        let juara1 = STATE.participants.find(p => p.id === gf.winnerId);
        let juara2 = STATE.participants.find(p => p.id === gf.loserId);
        
        // --- LOGIKA CERDAS PENENTUAN JUARA 3 BERSAMA ---
        let perungguArr = [];
        let mode = (STATE.settings && STATE.settings.tournamentMode) ? STATE.settings.tournamentMode : 'double';

        if (mode === 'single') {
            // MODE UMUM: Ambil 2 orang yang kalah di Semi-Final
            let sfs = poolMatches.filter(m => m.nextW === gf.matchNum && m.status === 'done');
            sfs.forEach(sf => {
                let p3 = STATE.participants.find(p => p.id === sf.loserId);
                if (p3) perungguArr.push({nama: p3.nama, kontingen: p3.kontingen});
            });
        } else {
            // MODE PERKEMI: Ambil dari Looser Bracket
            let finalBawah = poolMatches.find(m => m.babak.toUpperCase() === "FINAL BAWAH" || m.babak.toUpperCase() === "LB FINAL");
            let juara3a = (finalBawah && finalBawah.status === 'done') ? STATE.participants.find(p => p.id === finalBawah.loserId) : null;
            
            let lbSFinal = poolMatches.find(m => m.babak.toUpperCase() === "LB SEMI-FINAL" || m.babak.toUpperCase() === "LB S-FINAL" || m.babak.toUpperCase() === "LB SF" || m.babak.toUpperCase() === "LB R1");
            let juara3b = (lbSFinal && lbSFinal.status === 'done') ? STATE.participants.find(p => p.id === lbSFinal.loserId) : null;
            
            if(juara3a) perungguArr.push({nama: juara3a.nama, kontingen: juara3a.kontingen});
            if(juara3b) perungguArr.push({nama: juara3b.nama, kontingen: juara3b.kontingen});
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
    if(!filter) return;
    if(!confirm("⚠️ Batalkan status finalis untuk kategori ini?\nData akan dikembalikan ke Pool awal.")) return;
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
    if(changed) { saveToLocalStorage(); alert("Status Finalis dibatalkan!"); renderRanking(); checkExistingDrawing(); filterPesertaScoring(); }
}

function promoteToFinal() {
    const filter = document.getElementById('rank-filter-kategori').value;
    if(!filter) return alert("Pilih kategori spesifik terlebih dahulu!");
    const catObj = STATE.categories.find(c => c.name === filter);
    if(catObj && catObj.discipline === 'randori') return alert("Tindakan ini hanya untuk nomor Embu.");
    let list = STATE.participants.filter(p => p.kategori === filter && (p.pool === 'A' || p.pool === 'B'));
    if(list.length === 0) return alert("Kategori ini tidak memiliki sistem Pool penyisihan.");
    if(list.some(p => p.isFinalist)) return alert("Finalis sudah ditetapkan!");
    
    let numFinalists = parseInt(prompt("Masukkan JUMLAH finalis DARI MASING-MASING POOL (misal: 3):", "3"));
    if(!numFinalists || isNaN(numFinalists) || numFinalists <= 0) return;
    
    let poolA = list.filter(p => p.pool === 'A' && p.scores.b1.final > 0).sort((a,b) => b.scores.b1.final - a.scores.b1.final || b.scores.b1.tech - a.scores.b1.tech);
    let poolB = list.filter(p => p.pool === 'B' && p.scores.b1.final > 0).sort((a,b) => b.scores.b1.final - a.scores.b1.final || b.scores.b1.tech - a.scores.b1.tech);
    let combined = [...poolA.slice(0, numFinalists), ...poolB.slice(0, numFinalists)];
    
    if(combined.length === 0) return alert("Tidak ada data nilai.");
    if(confirm("Tetapkan " + combined.length + " peserta ini sebagai Finalis?")) {
        combined.forEach(w => { let p = STATE.participants.find(x => x.id === w.id); if(p) { p.isFinalist = true; p.urutFinal = 0; } });
        saveToLocalStorage(); alert("Finalis ditetapkan!"); renderRanking(); checkExistingDrawing(); filterPesertaScoring();
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
        microRankBtn.innerHTML = '<i class="fas fa-file-csv"></i> UNDUH HASIL';
        microRankBtn.onclick = () => exportHasilCSV(document.getElementById('rank-filter-kategori').value);
        btnPromote.parentElement.appendChild(microRankBtn);
    }

    if (!filter) {
        btnPromote.classList.add('hidden');
        if(microRankBtn) microRankBtn.classList.add('hidden');
        return container.innerHTML = `<div class="p-10 text-center text-slate-500 border border-dashed border-slate-700 rounded-xl"><i class="fas fa-filter text-3xl mb-3 text-slate-600 block"></i>Pilih kategori pertandingan di atas untuk melihat hasil klasemen.</div>`;
    }
    
    if(microRankBtn) microRankBtn.classList.remove('hidden');

    let catObj = STATE.categories.find(c => c.name === filter);
    let catList = STATE.participants.filter(p => p.kategori === filter); 
    const hasPools = catList.some(p => p.pool === 'A' || p.pool === 'B' || (p.pool === 'FINAL' && p.urut > 0)); 
    const hasFinal = catList.some(p => p.isFinalist); 
    
    if(catObj && catObj.discipline === 'embu' && hasPools) {
        btnPromote.classList.remove('hidden');
        if(!hasFinal) {
            btnPromote.innerHTML = '<i class="fas fa-arrow-up mr-2"></i>TETAPKAN FINALIS';
            btnPromote.className = "whitespace-nowrap bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors text-sm";
            btnPromote.onclick = promoteToFinal;
        } else {
            btnPromote.innerHTML = '<i class="fas fa-undo mr-2"></i>BATALKAN FINALIS';
            btnPromote.className = "whitespace-nowrap bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors text-sm";
            btnPromote.onclick = cancelFinalist;
        }
    } else {
        btnPromote.classList.add('hidden'); 
    }

    let hasData = catList.some(p => p.scores.b1.final > 0 || p.losses > 0 || (catObj.discipline === 'randori' && calculateRandoriFinalists(filter)));

    if(!hasData) {
        if(catObj.discipline === 'randori') { return container.innerHTML = `<div class="p-10 text-center text-slate-500 border border-dashed border-slate-700 rounded-xl">Turnamen Randori belum selesai / belum ada juara.</div>`; } 
        else { return container.innerHTML = `<div class="p-10 text-center text-slate-500 border border-dashed border-slate-700 rounded-xl">Belum ada data nilai di kategori ini.</div>`; }
    }

    let htmlOutput = `<h3 class="text-xl font-bold text-yellow-400 mt-4 mb-4 border-b-2 border-slate-700 pb-3 flex items-center gap-3"><span class="${catObj.discipline==='randori'?'bg-red-700':'bg-blue-600'} text-[10px] px-2 py-1 rounded font-black">${catObj.discipline.toUpperCase()}</span>${catObj.name}</h3>`;

    if(catObj.discipline === 'embu') {
        ['FINAL', 'SINGLE', 'A', 'B'].forEach(poolKey => { 
            let poolList = []; 
            if(poolKey === 'FINAL') { poolList = catList.filter(p => p.isFinalist); } 
            else if(poolKey === 'SINGLE') { poolList = catList.filter(p => p.pool === 'SINGLE' && p.scores.b1.final > 0); } 
            else { poolList = catList.filter(p => p.pool === poolKey && p.scores.b1.final > 0); }

            if(poolList.length === 0) return; 
            
            if(poolKey === 'FINAL') poolList.sort((a,b) => b.scores.b2.final - a.scores.b2.final || b.scores.b2.tech - a.scores.b2.tech); 
            else poolList.sort((a,b) => b.scores.b1.final - a.scores.b1.final || b.scores.b1.tech - a.scores.b1.tech); 
            
            let poolTitle = poolKey === 'SINGLE' ? 'KLASEMEN AKHIR' : poolKey === 'FINAL' ? '<i class="fas fa-star text-yellow-400"></i> KLASEMEN FINAL' : `KLASEMEN POOL ${poolKey}`; 
            htmlOutput += `<h4 class="text-md font-bold text-blue-400 mt-6 mb-3 pl-2 border-l-4 border-blue-500">${poolTitle}</h4>`; 
            
            htmlOutput += poolList.map((p, i) => { 
                let scoreVal = poolKey === 'FINAL' ? p.scores.b2.final : p.scores.b1.final;
                let isWaiting = poolKey === 'FINAL' && scoreVal === 0;
                let medal = isWaiting ? `<span class="text-xl font-bold text-slate-600">-</span>` : i === 0 ? '<i class="fas fa-medal text-yellow-400 text-2xl"></i>' : i === 1 ? '<i class="fas fa-medal text-slate-300 text-2xl"></i>' : i === 2 ? '<i class="fas fa-medal text-amber-600 text-2xl"></i>' : `<span class="text-2xl font-black text-slate-600">${i+1}</span>`;
                let displayScore = isWaiting ? "000.0" : scoreVal.toFixed(2);
                let displayLabel = isWaiting ? "Menunggu Nilai" : "Nilai Akhir";
                let displayColor = isWaiting ? "text-slate-500" : "text-white";

                return `<div class="flex flex-col md:flex-row items-start md:items-center bg-dark-card p-4 rounded-xl border border-slate-700 gap-4 mb-3 hover:bg-slate-800/50 transition-colors"><div class="w-12 text-center flex-shrink-0">${medal}</div><div class="flex-1 w-full"><div class="font-bold text-lg ${displayColor} whitespace-normal break-words">${p.nama} ${poolKey !== 'FINAL' && p.isFinalist ? '<span class="text-[10px] bg-yellow-500 text-black px-2 py-0.5 rounded ml-2 shadow-sm font-black tracking-wide">LULUS FINAL</span>' : ''}</div><div class="text-xs text-slate-400 mt-1"><span class="bg-slate-800 px-2 py-1 rounded border border-slate-700 shadow-sm">${p.kontingen}</span></div></div><div class="flex gap-4 w-full md:w-auto mt-4 md:mt-0 pt-4 md:pt-0 border-t md:border-t-0 border-slate-700"><div class="text-center md:text-right flex-1"><div class="text-[10px] ${isWaiting ? 'text-slate-500' : 'text-green-400'} font-bold uppercase tracking-wider">${displayLabel}</div><div class="text-2xl font-black ${displayColor}">${displayScore}</div></div></div></div>`; 
            }).join(''); 
        }); 
    } else {
        const poolResults = calculateRandoriFinalists(catObj.name);
        if(!poolResults) { 
            htmlOutput += `<div class="p-6 text-center text-slate-600 bg-slate-900/50 rounded-xl border border-slate-800 text-sm italic">Turnamen di kategori ini masih berlangsung.</div>`; 
        } else {
            poolResults.forEach(res => {
                let isFinalCat = catObj.name.toUpperCase().includes('FINAL');
                let isSinglePool = res.pool === '-';
                let title = isFinalCat || isSinglePool ? "PEMENANG MEDALI" : `JUARA POOL ${res.pool}`;
                let label1 = isFinalCat || isSinglePool ? "Juara 1 (Emas)" : `Juara 1 Pool ${res.pool}`;
                let label2 = isFinalCat || isSinglePool ? "Juara 2 (Perak)" : `Runner-Up Pool ${res.pool}`;
                let label3 = isFinalCat || isSinglePool ? "Juara 3 Bersama (Perunggu)" : `Juara 3 Pool ${res.pool}`;

                htmlOutput += `<h4 class="text-md font-bold text-red-400 mt-6 mb-3 pl-2 border-l-4 border-red-500">${title}</h4>`;
                if(res.emas) htmlOutput += `<div class="flex items-center bg-dark-card p-4 rounded-xl border border-yellow-600 gap-4 mb-3 bg-yellow-600/10"><div class="w-12 text-center flex-shrink-0"><i class="fas fa-medal text-yellow-400 text-3xl drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]"></i></div><div class="flex-1"><div class="font-bold text-lg text-white whitespace-normal break-words">${res.emas}</div><div class="text-xs text-slate-400 mt-1 uppercase font-bold text-yellow-500 tracking-wider">${res.emasKontingen} &bull; ${label1}</div></div></div>`;
                if(res.perak) htmlOutput += `<div class="flex items-center bg-dark-card p-4 rounded-xl border border-slate-600 gap-4 mb-3 bg-slate-500/10"><div class="w-12 text-center flex-shrink-0"><i class="fas fa-medal text-slate-300 text-3xl drop-shadow-[0_0_10px_rgba(203,213,225,0.5)]"></i></div><div class="flex-1"><div class="font-bold text-lg text-white whitespace-normal break-words">${res.perak}</div><div class="text-xs text-slate-400 mt-1 uppercase font-bold text-slate-300 tracking-wider">${res.perakKontingen} &bull; ${label2}</div></div></div>`;
                res.perunggu.forEach(p => { htmlOutput += `<div class="flex items-center bg-dark-card p-4 rounded-xl border border-amber-700 gap-4 mb-3 bg-amber-800/10"><div class="w-12 text-center flex-shrink-0"><i class="fas fa-medal text-amber-600 text-3xl drop-shadow-[0_0_10px_rgba(217,119,6,0.5)]"></i></div><div class="flex-1"><div class="font-bold text-lg text-white whitespace-normal break-words">${p.nama}</div><div class="text-xs text-slate-400 mt-1 uppercase font-bold text-amber-600 tracking-wider">${p.kontingen} &bull; ${label3}</div></div></div>`; });
            });
        }
    }
    container.innerHTML = htmlOutput; 
}

function renderJuaraUmum() { 
    let tally = {}; 
    const minPeserta = (STATE.settings && STATE.settings.minPesertaJuara) ? parseInt(STATE.settings.minPesertaJuara) : 1;

    STATE.categories.forEach(cat => { 
        let catParts = STATE.participants.filter(p => p.kategori === cat.name);
        const isFinalCategory = cat.name.toUpperCase().includes('FINAL');
        
        // --- SMART PARTICIPANT DETECTOR ---
        // 1. Cari nama dasar kategori dengan mengabaikan kata "FINAL"
        let baseName = cat.name.replace(/FINAL/ig, '').trim().toLowerCase();
        
        // 2. Kumpulkan semua atlet dari kategori awal (Penyisihan/Pool) maupun kategori Final
        let relatedParticipants = STATE.participants.filter(p => 
            p.kategori.replace(/FINAL/ig, '').trim().toLowerCase() === baseName
        );
        
        // 3. Hitung jumlah atlet UNIK (Mencegah hitungan ganda jika atlet dicopy dari Pool ke Final)
        let uniqueAthletes = new Set(relatedParticipants.map(p => p.nama.toLowerCase().trim()));
        let trueParticipantCount = uniqueAthletes.size;

        // ATURAN 1: Cek Batas Minimal Peserta secara akurat menggunakan True Count!
        if (trueParticipantCount < minPeserta) return; 

        if(cat.discipline === 'embu') {
            let listCat = catParts.filter(p => p.isFinalist); 
            let wins = listCat.filter(p => p.scores.b2.final > 0).sort((a,b) => b.scores.b2.final - a.scores.b2.final || b.scores.b2.tech - a.scores.b2.tech); 
            if(wins[0]) { tally[wins[0].kontingen] = tally[wins[0].kontingen] || {g:0, s:0, b:0}; tally[wins[0].kontingen].g++; } 
            if(wins[1]) { tally[wins[1].kontingen] = tally[wins[1].kontingen] || {g:0, s:0, b:0}; tally[wins[1].kontingen].s++; } 
            if(wins[2]) { tally[wins[2].kontingen] = tally[wins[2].kontingen] || {g:0, s:0, b:0}; tally[wins[2].kontingen].b++; } 
        } else {
            const hasPools = catParts.some(p => p.pool === 'A' || p.pool === 'B');
            
            // ATURAN 2: Jika Randori punya Pool, yang menyumbang medali hanya kategori "FINAL".
            if(hasPools && !isFinalCategory) return; 
            
            const poolResults = calculateRandoriFinalists(cat.name);
            if(!poolResults) return; 
            
            poolResults.forEach(res => {
                if(res.emasKontingen) { tally[res.emasKontingen] = tally[res.emasKontingen] || {g:0, s:0, b:0}; tally[res.emasKontingen].g++; }
                if(res.perakKontingen) { tally[res.perakKontingen] = tally[res.perakKontingen] || {g:0, s:0, b:0}; tally[res.perakKontingen].s++; }
                res.perunggu.forEach(p => { 
                    if(p.kontingen) { tally[p.kontingen] = tally[p.kontingen] || {g:0, s:0, b:0}; tally[p.kontingen].b++; } 
                });
            });
        }
    }); 

    let leaderboard = Object.keys(tally).map(kontingen => ({ nama: kontingen, emas: tally[kontingen].g, perak: tally[kontingen].s, perunggu: tally[kontingen].b, total: tally[kontingen].g + tally[kontingen].s + tally[kontingen].b })); 
    leaderboard.sort((a,b) => b.emas - a.emas || b.perak - a.perak || b.perunggu - a.perunggu); 
    
    const tbody = document.getElementById('table-juara-body'); 
    if(leaderboard.length === 0) return tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-500 border-b border-slate-700">Belum ada data medali disumbangkan.</td></tr>`; 
    tbody.innerHTML = leaderboard.map((k, i) => `<tr class="hover:bg-slate-800/50 transition-colors"><td class="p-4 text-center font-bold text-slate-500 border-b border-slate-800">${i+1}</td><td class="p-4 font-bold text-white border-b border-slate-800 text-lg whitespace-normal break-words">${k.nama}</td><td class="p-4 text-center font-black text-yellow-500 border-b border-slate-800 bg-yellow-500/10">${k.emas}</td><td class="p-4 text-center font-black text-slate-300 border-b border-slate-800 bg-slate-400/10">${k.perak}</td><td class="p-4 text-center font-black text-amber-600 border-b border-slate-800 bg-amber-600/10">${k.perunggu}</td><td class="p-4 text-center font-black text-blue-400 border-b border-slate-800">${k.total}</td></tr>`).join(''); 
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

function exportDrawingCSV(filterCatName = null) {
    // KITA TAMBAHKAN KOLOM KONTINGEN MERAH & PUTIH DI SINI
    let rows = [["Disiplin", "Kategori", "Pool / Babak", "No. Partai", "Sudut Merah (AKA)", "Kontingen Merah", "Skor Merah", "Sudut Putih (SHIRO)", "Kontingen Putih", "Skor Putih", "Status"]];
    let categoriesToExport = filterCatName ? STATE.categories.filter(c => c.name === filterCatName) : STATE.categories;
    
    categoriesToExport.forEach(cat => {
        if (cat.discipline === 'embu') {
            let catParts = STATE.participants.filter(p => p.kategori === cat.name && p.urut > 0).sort((a,b) => a.pool.localeCompare(b.pool) || a.urut - b.urut);
            catParts.forEach(p => {
                let poolLabel = p.isFinalist && p.urutFinal > 0 ? "FINAL" : `Pool ${p.pool}`;
                let noUrut = p.isFinalist && p.urutFinal > 0 ? p.urutFinal : p.urut;
                // Embu disesuaikan dengan format kolom baru
                rows.push(["EMBU", cat.name, poolLabel, noUrut, p.nama, p.kontingen, p.scores.b1.final||0, "", "", p.scores.b2.final||0, ""]);
            });
        } else {
            let catMatches = STATE.matches.filter(m => m.kategori === cat.name).sort((a,b) => a.matchNum - b.matchNum);
            catMatches.forEach(m => {
                let mrh = STATE.participants.find(x => x.id === m.merahId);
                let pth = STATE.participants.find(x => x.id === m.putihId);
                
                let nMrh = m.merahId === -1 ? "BYE" : (mrh ? mrh.nama : "Menunggu");
                let kMrh = m.merahId === -1 ? "-" : (mrh ? mrh.kontingen : "-");
                
                let nPth = m.putihId === -1 ? "BYE" : (pth ? pth.nama : "Menunggu");
                let kPth = m.putihId === -1 ? "-" : (pth ? pth.kontingen : "-");
                
                let displayNum = m.matchNum % 50 === 0 ? 50 : m.matchNum % 50;
                let poolLabel = m.pool !== '-' ? `Pool ${m.pool}` : 'Utama';
                
                rows.push(["RANDORI", cat.name, `${poolLabel} - ${m.babak}`, `G-${displayNum}`, nMrh, kMrh, m.skorMerah, nPth, kPth, m.skorPutih, m.status === 'done' ? "Selesai" : ""]);
            });
        }
    });
    let prefix = filterCatName ? `Jadwal_${filterCatName.replace(/[^a-zA-Z0-9]/g, '_')}` : `Semua_Jadwal_Pertandingan`;
    downloadCSV(`${prefix}_${new Date().toISOString().slice(0,10)}.csv`, rows);
}

function exportHasilCSV(filterCatName = null) {
    let categoriesToExport = filterCatName ? STATE.categories.filter(c => c.name === filterCatName) : STATE.categories;
    
    // 1. DETEKSI CERDAS: Apakah ini ekspor khusus kategori EMBU saja?
    let isOnlyEmbu = categoriesToExport.length > 0 && categoriesToExport.every(c => c.discipline === 'embu');

    // 2. BUAT HEADER DINAMIS (Beda format jika Embu vs Campuran/Randori)
    let rows = [];
    if (isOnlyEmbu) {
        rows.push(["Peringkat / Medali", "Kategori", "Nama Atlet", "Kontingen", "Wasit 1", "Wasit 2", "Wasit 3", "Wasit 4", "Wasit 5", "Waktu (MM:SS)", "Denda", "Nilai Akhir"]);
    } else {
        rows.push(["Disiplin", "Kategori", "Peringkat / Medali", "Nama Atlet", "Kontingen", "Nilai Akhir / Keterangan"]);
    }

    categoriesToExport.forEach(cat => {
        if (cat.discipline === 'embu') {
            let finalis = STATE.participants.filter(p => p.kategori === cat.name && p.isFinalist && p.scores.b2.final > 0);
            if(finalis.length > 0) {
                finalis.sort((a,b) => b.scores.b2.final - a.scores.b2.final || b.scores.b2.tech - a.scores.b2.tech);
                finalis.forEach((p, i) => {
                    let medali = i === 0 ? "Emas" : i === 1 ? "Perak" : i === 2 ? "Perunggu" : `Peringkat ${i+1}`;
                    let s = p.scores.b2;
                    
                    if (isOnlyEmbu) {
                        let w = s.raw || [];
                        let waktuFmt = `${Math.floor((s.time||0)/60).toString().padStart(2,'0')}:${((s.time||0)%60).toString().padStart(2,'0')}`;
                        rows.push([medali, cat.name, p.nama, p.kontingen, w[0]||'-', w[1]||'-', w[2]||'-', w[3]||'-', w[4]||'-', waktuFmt, s.penalty || 0, s.final.toFixed(2)]);
                    } else {
                        rows.push(["EMBU", cat.name, medali, p.nama, p.kontingen, s.final.toFixed(2)]);
                    }
                });
            } else {
                ['SINGLE', 'A', 'B'].forEach(poolKey => {
                    let poolList = STATE.participants.filter(p => p.kategori === cat.name && p.pool === poolKey && p.scores.b1.final > 0);
                    poolList.sort((a,b) => b.scores.b1.final - a.scores.b1.final || b.scores.b1.tech - a.scores.b1.tech);
                    poolList.forEach((p, i) => { 
                        let medali = poolKey === 'SINGLE' ? `Peringkat ${i+1}` : `Pool ${poolKey} Rank ${i+1}`;
                        let s = p.scores.b1;

                        if (isOnlyEmbu) {
                            let w = s.raw || [];
                            let waktuFmt = `${Math.floor((s.time||0)/60).toString().padStart(2,'0')}:${((s.time||0)%60).toString().padStart(2,'0')}`;
                            rows.push([medali, cat.name, p.nama, p.kontingen, w[0]||'-', w[1]||'-', w[2]||'-', w[3]||'-', w[4]||'-', waktuFmt, s.penalty || 0, s.final.toFixed(2)]);
                        } else {
                            rows.push(["EMBU", cat.name, medali, p.nama, p.kontingen, s.final.toFixed(2)]);
                        }
                    });
                });
            }
        } else {
            // --- LOGIKA EKSPOR RANDORI TETAP SAMA ---
            let poolResults = calculateRandoriFinalists(cat.name);
            if (poolResults) {
                poolResults.forEach(res => {
                    let isFinalCat = cat.name.toUpperCase().includes('FINAL');
                    let isSinglePool = res.pool === '-';
                    let label1 = isFinalCat || isSinglePool ? "Juara 1 (Emas)" : `Juara 1 Pool ${res.pool}`;
                    let label2 = isFinalCat || isSinglePool ? "Juara 2 (Perak)" : `Runner-Up Pool ${res.pool}`;
                    let label3 = isFinalCat || isSinglePool ? "Juara 3 Bersama (Perunggu)" : `Juara 3 Pool ${res.pool}`;

                    if(res.emas) rows.push(["RANDORI", cat.name, isFinalCat||isSinglePool?"Emas":`Juara 1 P-${res.pool}`, res.emas, res.emasKontingen, label1]);
                    if(res.perak) rows.push(["RANDORI", cat.name, isFinalCat||isSinglePool?"Perak":`Runner-Up P-${res.pool}`, res.perak, res.perakKontingen, label2]);
                    res.perunggu.forEach(p => {
                        rows.push(["RANDORI", cat.name, isFinalCat||isSinglePool?"Perunggu":`Juara 3 P-${res.pool}`, p.nama, p.kontingen, label3]);
                    });
                });
            }
        }
    });
    
    let prefix = filterCatName ? `Hasil_${filterCatName.replace(/[^a-zA-Z0-9]/g, '_')}` : `Semua_Hasil_Pertandingan`;
    downloadCSV(`${prefix}_${new Date().toISOString().slice(0,10)}.csv`, rows);
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

        if(cat.discipline === 'embu') {
            let listCat = catParts.filter(p => p.isFinalist); 
            let wins = listCat.filter(p => p.scores.b2.final > 0).sort((a,b) => b.scores.b2.final - a.scores.b2.final || b.scores.b2.tech - a.scores.b2.tech); 
            if(wins[0]) { tally[wins[0].kontingen] = tally[wins[0].kontingen] || {g:0, s:0, b:0}; tally[wins[0].kontingen].g++; } 
            if(wins[1]) { tally[wins[1].kontingen] = tally[wins[1].kontingen] || {g:0, s:0, b:0}; tally[wins[1].kontingen].s++; } 
            if(wins[2]) { tally[wins[2].kontingen] = tally[wins[2].kontingen] || {g:0, s:0, b:0}; tally[wins[2].kontingen].b++; } 
        } else {
            const hasPools = catParts.some(p => p.pool === 'A' || p.pool === 'B');
            
            if(hasPools && !isFinalCategory) return; 
            
            const poolResults = calculateRandoriFinalists(cat.name);
            if(!poolResults) return; 
            
            poolResults.forEach(res => {
                if(res.emasKontingen) { tally[res.emasKontingen] = tally[res.emasKontingen] || {g:0, s:0, b:0}; tally[res.emasKontingen].g++; }
                if(res.perakKontingen) { tally[res.perakKontingen] = tally[res.perakKontingen] || {g:0, s:0, b:0}; tally[res.perakKontingen].s++; }
                res.perunggu.forEach(p => { 
                    if(p.kontingen) { tally[p.kontingen] = tally[p.kontingen] || {g:0, s:0, b:0}; tally[p.kontingen].b++; } 
                });
            });
        }
    }); 

    let leaderboard = Object.keys(tally).map(kontingen => ({ nama: kontingen, emas: tally[kontingen].g, perak: tally[kontingen].s, perunggu: tally[kontingen].b, total: tally[kontingen].g + tally[kontingen].s + tally[kontingen].b })); 
    leaderboard.sort((a,b) => b.emas - a.emas || b.perak - a.perak || b.perunggu - a.perunggu); 
    
    let rows = [["Peringkat", "Kontingen", "Emas", "Perak", "Perunggu", "Total Medali"]];
    leaderboard.forEach((k, i) => { rows.push([i + 1, k.nama, k.emas, k.perak, k.perunggu, k.total]); });
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF" + rows.map(e => e.map(cell => `"${cell}"`).join(";")).join("\n");
    
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `Klasemen_Medali_Juara_Umum_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
}

function exportCustomCSV() { exportHasilCSV(null); } // Legacy fallback
function resetAllPenilaian() { 
    if(confirm('⚠️ PERHATIAN: Ini akan MENGHAPUS SEMUA SKOR & PARTAI RANDORI di seluruh jaringan. Yakin?')) { 
        // 1. Bersihkan nilai di memori lokal
        STATE.participants.forEach(p => { 
            p.scores = { b1: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 }, b2: { raw: [], techRaw: [], penalty: 0, final: 0, tech: 0, time: 0 } }; 
            p.finalScore = 0; p.techScore = 0; p.isFinalist = false; p.urutFinal = 0; p.losses = 0; 
        }); 
        STATE.matches = []; 
        
        // 2. Tembakkan perintah hapus spesifik ke Firebase
        let updates = {};
        updates['turnamen_data/participants'] = STATE.participants;
        updates['turnamen_data/matches'] = null; // 'null' di Firebase berarti HAPUS NODE

        database.ref().update(updates).then(() => {
            alert('✅ Berhasil: Semua Nilai & Bagan telah di-reset dari server!');
        }).catch(err => alert("Gagal Reset: " + err));
    } 
}

function resetDataAtlet() { 
    if(confirm('⚠️ PERHATIAN: Ini MENGHAPUS SEMUA ATLET & BAGAN di seluruh jaringan. Yakin?')) { 
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
    if(confirm('🚨 FACTORY RESET: Anda yakin ingin menghapus seluruh sistem (Kategori, Atlet, Nilai) secara permanen dari server?')) { 
        
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
    downloadAnchorNode.setAttribute("download", `Backup_MASS_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchorNode); 
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function restoreDatabase(event) {
    const file = event.target.files[0]; 
    if (!file) return;
    
    // 1. Peringatan keras sebelum menimpa data server
    if(!confirm("⚠️ PERINGATAN KRITIS!\n\nMere-store data akan MENGHAPUS & MENIMPA seluruh data turnamen online saat ini dengan data dari file.\n\nApakah Anda sangat yakin ingin melanjutkan?")) {
        event.target.value = ''; 
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
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
function handleEmbuSwap(participantId) {
    const catName = document.getElementById('draw-select-kategori').value;
    if(!catName) return;

    if (EMBU_SWAP_SELECTION === null) {
        EMBU_SWAP_SELECTION = participantId;
        checkExistingDrawing(); // <--- MEMANGGIL FUNGSI YANG BENAR
        return;
    }

    if (EMBU_SWAP_SELECTION === participantId) {
        EMBU_SWAP_SELECTION = null;
        checkExistingDrawing(); // <--- MEMANGGIL FUNGSI YANG BENAR
        return;
    }

    let p1 = STATE.participants.find(p => p.id === EMBU_SWAP_SELECTION);
    let p2 = STATE.participants.find(p => p.id === participantId);

    if (p1 && p2) {
        let tempUrut = p1.urut;
        p1.urut = p2.urut;
        p2.urut = tempUrut;

        let tempPool = p1.pool;
        p1.pool = p2.pool;
        p2.pool = tempPool;

        let tempUrutFinal = p1.urutFinal;
        p1.urutFinal = p2.urutFinal;
        p2.urutFinal = tempUrutFinal;
    }

    EMBU_SWAP_SELECTION = null;
    saveToLocalStorage();
    checkExistingDrawing(); // <--- MEMANGGIL FUNGSI YANG BENAR
}
