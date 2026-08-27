/**
 * MASS KEMPO - Modul Analisa Performa Wasit (Production Ready)
 * Terkoneksi Penuh dengan Arsitektur Local SQLite, Hybrid, dan Firebase RTDB
 */

const MASS_ANALISA = (function () {
    const CONFIG = {
        alertThreshold: 4.0,   // Ambang batas deviasi skor untuk alert anomali
        maxToleranceRAI: 6.0,  // Toleransi deviasi maksimum (MAE) untuk skor RAI 0%
        yTotalMin: 80,         // Skala fix sumbu Y Total (Kiri)
        yTotalMax: 95,
        yTechMin: 45,          // Skala fix sumbu Y Teknik (Kanan)
        yTechMax: 65,
        colors: {
            baseline: '#ffffff',
            wasit: [
                '#38bdf8', // W1: Sky-400
                '#a855f7', // W2: Purple-500
                '#f59e0b', // W3: Amber-500
                '#10b981', // W4: Emerald-500
                '#ec4899'  // W5: Pink-500
            ]
        }
    };

    let state = {
        mode: 'lokal', // 'lokal' | 'cloud' | 'file' | 'cache'
        database: null,
        rtdbListener: null,
        rawTurnamenData: null,
        uploadedBackupData: null,
        normalizedEntries: [],
        filteredEntries: [],
        wasitNames: ['Wasit 1', 'Wasit 2', 'Wasit 3', 'Wasit 4', 'Wasit 5'],
        wasitStats: [],
        chartInstance: null,
        showTotalLines: true,
        showTechLines: true,
        showBaseline: true,
        visibleWasit: [true, true, true, true, true]
    };

    // 1. ENGINE AUTO-INGESTION: Deteksi Mode Server & Tarik Data Otomatis
    async function initSystemAndFetch() {
        // Jika sedang dalam mode file backup manual, prioritaskan render data file aktif
        if (state.mode === 'file' && state.uploadedBackupData) {
            parseTurnamenData(state.uploadedBackupData);
            updateSyncStatus('Mode File Backup JSON', 'file');
            return;
        }

        updateSyncStatus('Mendeteksi Sumber Data...', 'loading');

        const hostname = window.location.hostname;
        const isStaticHost = hostname.includes('github.io') || 
                             hostname.includes('netlify.app') || 
                             hostname.includes('pages.dev') || 
                             hostname.includes('vercel.app') ||
                             window.location.protocol === 'file:';

        // 1. Jalur Static / Cloud Host
        if (isStaticHost) {
            const connected = tryLoadFromSessionAndFirebase();
            if (!connected) {
                tryLoadFromLocalStorage();
            }
            return;
        }

        // 2. Jalur Local Server Node.js / SQLite
        try {
            const netRes = await fetch('/api/network');
            if (!netRes.ok) throw new Error("Endpoint network tidak aktif");

            const netData = await netRes.json();
            state.mode = (netData.mode || 'lokal').toLowerCase();

            if (state.mode !== 'lokal' && state.mode !== 'local' && netData.rtdb_config) {
                initFirebaseRTDB(netData.rtdb_config);
                return;
            }

            const localRes = await fetch('/api/data_turnamen');
            if (!localRes.ok) throw new Error("Gagal mengambil data turnamen lokal");

            const localData = await localRes.json();
            state.rawTurnamenData = localData;
            parseTurnamenData(localData);
            updateSyncStatus('Lokal Murni (LAN SQLite)', 'cache');

        } catch (err) {
            console.warn("Backend lokal tidak terdeteksi, beralih ke sesi browser:", err.message);
            const connected = tryLoadFromSessionAndFirebase();
            if (!connected) {
                tryLoadFromLocalStorage();
            }
        }
    }

    function tryLoadFromSessionAndFirebase() {
        try {
            const rawSession = localStorage.getItem('mass_kempo_session');
            if (!rawSession) return false;

            const session = JSON.parse(rawSession);
            const rtdbConfig = session.serverConfig?.rtdbConfig || session.rtdbConfig;

            if (rtdbConfig && rtdbConfig.apiKey && rtdbConfig.databaseURL) {
                initFirebaseRTDB(rtdbConfig);
                return true;
            }
        } catch (e) {
            console.error("Gagal membaca mass_kempo_session:", e);
        }
        return false;
    }

    function initFirebaseRTDB(rtdbConfig) {
        if (typeof firebase === 'undefined') {
            updateSyncStatus('Firebase SDK Tidak Ditemukan', 'error');
            return;
        }

        if (!firebase.apps.length) {
            firebase.initializeApp(rtdbConfig);
        }
        state.database = firebase.database();
        state.mode = 'cloud';

        if (state.rtdbListener) {
            state.database.ref('turnamen_data').off('value', state.rtdbListener);
        }

        state.rtdbListener = state.database.ref('turnamen_data').on('value', (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                state.rawTurnamenData = data;
                parseTurnamenData(data);
                updateSyncStatus('Terhubung (Cloud Realtime)', 'cloud');
            } else {
                updateSyncStatus('Cloud Kosong (Menunggu Data)', 'loading');
            }
        }, (err) => {
            console.error("RTDB Error:", err);
            tryLoadFromLocalStorage();
        });
    }

    function tryLoadFromLocalStorage() {
        try {
            const masterRaw = localStorage.getItem('mass_kempo_master_data');
            if (masterRaw) {
                const localData = JSON.parse(masterRaw);
                state.rawTurnamenData = localData;
                parseTurnamenData(localData);
                updateSyncStatus('Offline (Data Cache Lokal)', 'cache');
                return;
            }
        } catch (e) {
            console.error("Gagal membaca mass_kempo_master_data:", e);
        }
        updateSyncStatus('Koneksi Terputus (Offline)', 'error');
    }

    function updateSyncStatus(text, status) {
        const txtEl = document.getElementById('syncText');
        const dotEl = document.getElementById('syncDot');
        const badgeEl = document.getElementById('syncBadge');
        if (!txtEl || !dotEl || !badgeEl) return;

        txtEl.textContent = text;
        
        switch (status) {
            case 'loading':
                dotEl.className = "w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse";
                badgeEl.className = "flex items-center gap-2 px-3 py-1.5 bg-amber-950/40 border border-amber-800/60 rounded-xl text-xs font-semibold text-amber-300";
                break;
            case 'cloud':
                dotEl.className = "w-2.5 h-2.5 rounded-full bg-emerald-400";
                badgeEl.className = "flex items-center gap-2 px-3 py-1.5 bg-emerald-950/40 border border-emerald-800/60 rounded-xl text-xs font-semibold text-emerald-300";
                break;
            case 'file':
                dotEl.className = "w-2.5 h-2.5 rounded-full bg-blue-400";
                badgeEl.className = "flex items-center gap-2 px-3 py-1.5 bg-blue-950/40 border border-blue-800/60 rounded-xl text-xs font-semibold text-blue-300";
                break;
            case 'cache':
                dotEl.className = "w-2.5 h-2.5 rounded-full bg-cyan-400";
                badgeEl.className = "flex items-center gap-2 px-3 py-1.5 bg-cyan-950/40 border border-cyan-800/60 rounded-xl text-xs font-semibold text-cyan-300";
                break;
            default:
                dotEl.className = "w-2.5 h-2.5 rounded-full bg-rose-500";
                badgeEl.className = "flex items-center gap-2 px-3 py-1.5 bg-rose-950/40 border border-rose-800/60 rounded-xl text-xs font-semibold text-rose-300";
                break;
        }
    }

function handleJsonFileUpload(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const parsed = JSON.parse(e.target.result);
                
                // Normalisasi jika backup dibungkus dalam node turnamen_data
                const dataTurnamen = parsed.turnamen_data ? parsed.turnamen_data : parsed;

                const hasMatches = Array.isArray(dataTurnamen.matches);
                const hasParticipants = Array.isArray(dataTurnamen.participants);

                if (!hasMatches && !hasParticipants) {
                    alert('Format file JSON tidak valid. Pastikan file berisi data pertandingan MASS KEMPO.');
                    return;
                }

                // Matikan listener RTDB jika sedang aktif agar tidak tertimpa
                if (state.database && state.rtdbListener) {
                    state.database.ref('turnamen_data').off('value', state.rtdbListener);
                    state.rtdbListener = null;
                }

                state.mode = 'file';
                state.uploadedBackupData = dataTurnamen;
                state.rawTurnamenData = dataTurnamen;

                parseTurnamenData(dataTurnamen);
                updateSyncStatus(`Mode File Backup JSON (${file.name})`, 'file');

            } catch (err) {
                console.error("Gagal parse file JSON:", err);
                alert('Gagal memproses file JSON. Format file rusak atau bukan JSON valid.');
            }
        };
        reader.readAsText(file);
    }
    
    // 2. PARSER DATA 2 TIPE PERTANDINGAN
    function parseTurnamenData(data) {
        if (!data) return;

        const parsed = [];
        const participants = data.participants || [];
        const matches = data.matches || [];
        const categories = data.categories || [];
        const barcodes = data.barcodes || [];

        const wasitList = barcodes.filter(b => b.jabatan && String(b.jabatan).trim().toUpperCase() === 'WASIT');
        if (wasitList.length >= 5) {
            state.wasitNames = wasitList.slice(0, 5).map(w => w.nama);
        }

        // SKEMA A: EMBU H2H
        matches.forEach(m => {
            const catObj = categories.find(c => c.name === m.kategori);
            const isEmbu = !catObj || catObj.discipline === 'embu';

            if (isEmbu) {
                const gameNum = m.matchNum % 50 === 0 ? 50 : m.matchNum % 50;

                if (m.rawMerah && Array.isArray(m.rawMerah) && m.rawMerah.length === 5 && m.skorMerah > 0) {
                    const pMrh = participants.find(p => p.id === m.merahId);
                    parsed.push(createEntry({
                        id: `H2H-M-${m.id}`,
                        kategori: m.kategori,
                        matchType: 'H2H',
                        pool: m.pool || '-',
                        gameNum: `G-${gameNum}`,
                        subLabel: `Game ${gameNum} (${m.babak || 'Penyisihan'})`,
                        peserta: pMrh ? pMrh.nama : 'Pita Merah',
                        kontingen: pMrh ? pMrh.kontingen : '-',
                        scores: m.rawMerah,
                        petugas: m.petugasMerah || []
                    }));
                }

                if (m.rawPutih && Array.isArray(m.rawPutih) && m.rawPutih.length === 5 && m.skorPutih > 0) {
                    const pPth = participants.find(p => p.id === m.putihId);
                    parsed.push(createEntry({
                        id: `H2H-P-${m.id}`,
                        kategori: m.kategori,
                        matchType: 'H2H',
                        pool: m.pool || '-',
                        gameNum: `G-${gameNum}`,
                        subLabel: `Game ${gameNum} (${m.babak || 'Penyisihan'})`,
                        peserta: pPth ? pPth.nama : 'Pita Putih',
                        kontingen: pPth ? pPth.kontingen : '-',
                        scores: m.rawPutih,
                        petugas: m.petugasPutih || []
                    }));
                }
            }
        });

        // SKEMA B: EMBU BAKU & FESTIVAL
        participants.forEach(p => {
            const catObj = categories.find(c => c.name === p.kategori);
            const isFestival = catObj && catObj.discipline === 'festival';

            if (p.scores) {
                if (p.scores.b1 && p.scores.b1.raw && p.scores.b1.raw.length === 5 && p.scores.b1.final > 0) {
                    const matchType = isFestival ? 'FESTIVAL' : 'BAKU';
                    const poolVal = p.pool || (isFestival ? 'A' : 'SINGLE');
                    
                    let subLabel = 'Babak 1 (Penyisihan)';
                    if (isFestival) subLabel = `Kelompok ${poolVal}`;
                    else if (p.pool !== '-' && p.pool !== 'SINGLE') subLabel = `Pool ${p.pool} (Babak 1)`;

                    parsed.push(createEntry({
                        id: `BAKU-B1-${p.id}`,
                        kategori: p.kategori,
                        matchType: matchType,
                        pool: poolVal,
                        subLabel: subLabel,
                        babakKey: 'B1',
                        kelompokKey: poolVal,
                        peserta: p.nama,
                        kontingen: p.kontingen,
                        scores: p.scores.b1.raw,
                        petugas: []
                    }));
                }

                if (p.scores.b2 && p.scores.b2.raw && p.scores.b2.raw.length === 5 && p.scores.b2.final > 0) {
                    const isFinal = p.isFinalist;
                    parsed.push(createEntry({
                        id: `BAKU-B2-${p.id}`,
                        kategori: p.kategori,
                        matchType: 'BAKU',
                        pool: p.pool || 'SINGLE',
                        subLabel: isFinal ? 'Babak Final' : 'Babak 2',
                        babakKey: isFinal ? 'FINAL' : 'B2',
                        peserta: p.nama,
                        kontingen: p.kontingen,
                        scores: p.scores.b2.raw,
                        petugas: []
                    }));
                }
            }
        });

        state.normalizedEntries = parsed;
        populateCategoryDropdown();
        updateDynamicFilters();
        applyFilterAndRender();
    }

    function createEntry(payload) {
        const scores = (payload.scores || []).map(s => Number(s) || 0);
        const techScores = (payload.techScores || []).map(t => Number(t) || 0);

        // Baseline Total (Trimmed Mean 3 Wasit Tengah)
        const sortedScores = [...scores].sort((a, b) => a - b);
        const centralScores = sortedScores.slice(1, 4);
        const baselineTotal = centralScores.length > 0
            ? parseFloat((centralScores.reduce((acc, v) => acc + v, 0) / centralScores.length).toFixed(2))
            : 0;

        // Baseline Teknik (Trimmed Mean 3 Wasit Tengah Teknik)
        const sortedTech = [...techScores].sort((a, b) => a - b);
        const centralTech = sortedTech.slice(1, 4);
        const baselineTech = centralTech.length > 0
            ? parseFloat((centralTech.reduce((acc, v) => acc + v, 0) / centralTech.length).toFixed(2))
            : 0;

        // Fallback Nama Wasit: Ambil nama asli jika ada, jika tidak gunakan 'Wasit 1..5'[cite: 7]
        if (payload.petugas && payload.petugas.length === 5) {
            state.wasitNames = payload.petugas.map((n, idx) => (n && n.trim() !== '') ? n.trim() : `Wasit ${idx + 1}`);
        }

        return {
            ...payload,
            scores: scores,
            techScores: techScores,
            minScore: sortedScores[0] || 0,
            maxScore: sortedScores[4] || 0,
            baseline: baselineTotal,
            baselineTech: baselineTech
        };
    }

    // 3. DROPDOWN & FILTER LOGIC
    function populateCategoryDropdown() {
        const select = document.getElementById('filterKategori');
        if (!select) return;
        const currentVal = select.value;
        const categories = [...new Set(state.normalizedEntries.map(m => m.kategori))];

        select.innerHTML = '<option value="ALL" class="bg-slate-900">Semua Kategori Embu</option>';
        categories.forEach(cat => {
            if (cat) {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.className = 'bg-slate-900';
                opt.textContent = cat;
                select.appendChild(opt);
            }
        });

        if (categories.includes(currentVal)) {
            select.value = currentVal;
        }
    }

    function updateDynamicFilters() {
        const catSelect = document.getElementById('filterKategori');
        const poolSelect = document.getElementById('filterPool');
        const subSelect = document.getElementById('filterSub');
        const wrapperPool = document.getElementById('wrapperFilterPool');
        const wrapperSub = document.getElementById('wrapperFilterSub');

        if (!catSelect || !poolSelect || !subSelect) return;

        const selectedCat = catSelect.value;
        const relevantEntries = selectedCat === 'ALL'
            ? state.normalizedEntries
            : state.normalizedEntries.filter(e => e.kategori === selectedCat);

        // Reset filter turunan ke default 'ALL' saat kategori berganti
        poolSelect.value = 'ALL';
        subSelect.value = 'ALL';

        if (relevantEntries.length === 0) {
            if (wrapperPool) wrapperPool.classList.add('hidden');
            if (wrapperSub) wrapperSub.classList.add('hidden');
            return;
        }

        const matchType = relevantEntries[0].matchType;

        // Update Filter Pool
        const pools = [...new Set(relevantEntries.map(e => e.pool))].filter(p => p && p !== '-');
        if (pools.length > 1 || (pools.length === 1 && pools[0] !== 'SINGLE')) {
            if (wrapperPool) wrapperPool.classList.remove('hidden');
            poolSelect.innerHTML = '<option value="ALL" class="bg-slate-900">Semua Pool</option>';
            pools.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                opt.className = 'bg-slate-900';
                opt.textContent = p === 'SINGLE' ? 'Single Pool' : `Pool ${p}`;
                poolSelect.appendChild(opt);
            });
        } else {
            if (wrapperPool) wrapperPool.classList.add('hidden');
        }

        // Update Sub-Filter (Partai / Babak / Kelompok)
        if (wrapperSub) wrapperSub.classList.remove('hidden');

        if (matchType === 'H2H') {
            const games = [...new Set(relevantEntries.map(e => e.gameNum))].sort();
            subSelect.innerHTML = '<option value="ALL" class="bg-slate-900">Semua Games (Partai)</option>';
            games.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g;
                opt.className = 'bg-slate-900';
                opt.textContent = `Partai ${g}`;
                subSelect.appendChild(opt);
            });
        } else if (matchType === 'BAKU') {
            subSelect.innerHTML = `
                <option value="ALL" class="bg-slate-900">Semua Babak</option>
                <option value="B1" class="bg-slate-900">Babak 1 (Penyisihan)</option>
                <option value="B2" class="bg-slate-900">Babak 2</option>
                <option value="FINAL" class="bg-slate-900">Babak Final</option>
            `;
        } else if (matchType === 'FESTIVAL') {
            const kelompokList = [...new Set(relevantEntries.map(e => e.pool))].sort();
            subSelect.innerHTML = '<option value="ALL" class="bg-slate-900">Semua Kelompok</option>';
            kelompokList.forEach(k => {
                const opt = document.createElement('option');
                opt.value = k;
                opt.className = 'bg-slate-900';
                opt.textContent = `Kelompok ${k}`;
                subSelect.appendChild(opt);
            });
        }
    }

    function applyFilterAndRender() {
        const catSelect = document.getElementById('filterKategori');
        const poolSelect = document.getElementById('filterPool');
        const subSelect = document.getElementById('filterSub');

        const catVal = catSelect ? catSelect.value : 'ALL';
        const poolVal = poolSelect ? poolSelect.value : 'ALL';
        const subVal = subSelect ? subSelect.value : 'ALL';

        state.filteredEntries = state.normalizedEntries.filter(e => {
            const matchCat = (catVal === 'ALL' || e.kategori === catVal);
            const matchPool = (poolVal === 'ALL' || e.pool === poolVal || (poolVal === 'SINGLE' && (e.pool === '-' || e.pool === 'SINGLE')));

            let matchSub = true;
            if (subVal !== 'ALL') {
                if (e.matchType === 'H2H') matchSub = (e.gameNum === subVal);
                else if (e.matchType === 'BAKU') matchSub = (e.babakKey === subVal);
                else if (e.matchType === 'FESTIVAL') matchSub = (e.pool === subVal);
            }

            return matchCat && matchPool && matchSub;
        });

        calculateStatistics();
        renderKPICards();
        renderScorecardTable();
        renderTrendChart();
    }

    // 4. STATISTICAL QUALITY CONTROL ENGINE (MAE, Bias, RAI)
    function calculateStatistics() {
        const n = state.filteredEntries.length;
        if (n === 0) {
            state.wasitStats = [];
            return;
        }

        const metrics = Array.from({ length: 5 }, (_, i) => ({
            index: i + 1,
            name: state.wasitNames[i] || `Wasit ${i + 1}`,
            sumScore: 0,
            sumMAE: 0,
            maxDroppedCount: 0,
            minDroppedCount: 0,
            anomalyCount: 0
        }));

        state.filteredEntries.forEach(m => {
            m.scores.forEach((score, wIdx) => {
                metrics[wIdx].sumScore += score;
                const diff = Math.abs(score - m.baseline);
                metrics[wIdx].sumMAE += diff;

                if (score === m.maxScore) metrics[wIdx].maxDroppedCount++;
                if (score === m.minScore) metrics[wIdx].minDroppedCount++;
                if (diff >= CONFIG.alertThreshold) metrics[wIdx].anomalyCount++;
            });
        });

        state.wasitStats = metrics.map((w, idx) => {
            const mae = parseFloat((w.sumMAE / n).toFixed(2));
            const avgScore = parseFloat((w.sumScore / n).toFixed(1));
            const leniencyRate = parseFloat(((w.maxDroppedCount / n) * 100).toFixed(1));
            const strictnessRate = parseFloat(((w.minDroppedCount / n) * 100).toFixed(1));
            const rai = Math.max(0, Math.round(100 * (1 - (mae / CONFIG.maxToleranceRAI))));

            return {
                ...w,
                name: state.wasitNames[idx] || `Wasit ${idx + 1}`,
                avgScore,
                mae,
                leniencyRate,
                strictnessRate,
                rai
            };
        });
    }

    // 5. UI RENDERING
    function renderKPICards() {
        const n = state.filteredEntries.length;
        const counterEl = document.getElementById('matchCounterText');
        if (counterEl) counterEl.textContent = `${n} Penampilan Dinilai`;

        if (n === 0 || state.wasitStats.length === 0) {
            setKPIText('kpiAvgDev', "0.00");
            setKPIText('kpiAnomalyCount', "0");
            setKPIText('kpiLenientName', "-");
            setKPIText('kpiLenientRate', "0% skor terbuang");
            setKPIText('kpiStrictName', "-");
            setKPIText('kpiStrictRate', "0% skor terbuang");
            return;
        }

        const totalMAE = state.wasitStats.reduce((acc, w) => acc + w.mae, 0);
        const avgGlobalMAE = (totalMAE / 5).toFixed(2);
        const totalAnomalies = state.wasitStats.reduce((acc, w) => acc + w.anomalyCount, 0);

        // Cari wasit dengan kecenderungan max dan min tertinggi
        let mostLenient = [...state.wasitStats].sort((a, b) => b.leniencyRate - a.leniencyRate)[0];
        let mostStrict = [...state.wasitStats].sort((a, b) => b.strictnessRate - a.strictnessRate)[0];

        setKPIText('kpiAvgDev', avgGlobalMAE);
        setKPIText('kpiAnomalyCount', totalAnomalies);

        if (mostLenient && mostLenient.maxDroppedCount > 0) {
            setKPIText('kpiLenientName', mostLenient.name);
            setKPIText('kpiLenientRate', `${mostLenient.leniencyRate}% skor terbuang (Murah)`);
        } else {
            setKPIText('kpiLenientName', "Seimbang");
            setKPIText('kpiLenientRate', "0% deviasi ekstrem atas");
        }

        if (mostStrict && mostStrict.minDroppedCount > 0) {
            setKPIText('kpiStrictName', mostStrict.name);
            setKPIText('kpiStrictRate', `${mostStrict.strictnessRate}% skor terbuang (Pelit)`);
        } else {
            setKPIText('kpiStrictName', "Seimbang");
            setKPIText('kpiStrictRate', "0% deviasi ekstrem bawah");
        }
    }

    function setKPIText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function renderScorecardTable() {
        const tbody = document.getElementById('wasitScorecardBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (state.wasitStats.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-500 font-sans italic">Belum ada data penilaian yang selesai pada filter ini.</td></tr>`;
            return;
        }

        state.wasitStats.forEach((w, idx) => {
            let badgeClass = "bg-emerald-950 text-emerald-300 border-emerald-700/80";
            let statusText = "Sangat Presisi";

            if (w.rai < 70) {
                badgeClass = "bg-rose-950 text-rose-300 border-rose-700/80";
                statusText = "Perlu Evaluasi";
            } else if (w.rai < 85) {
                badgeClass = "bg-amber-950 text-amber-300 border-amber-700/80";
                statusText = "Cukup Konsisten";
            }

            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-800/40 transition border-b border-slate-800 text-center";
            tr.innerHTML = `
                <td class="py-3.5 px-4 text-left font-semibold text-white font-sans flex items-center gap-2.5">
                    <span class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: ${CONFIG.colors.wasit[idx]}"></span>
                    <span>${w.name}</span>
                </td>
                <td class="py-3.5 px-4">${w.avgScore}</td>
                <td class="py-3.5 px-4 font-bold ${w.mae > 3.0 ? 'text-amber-400' : 'text-slate-200'}">±${w.mae} pt</td>
                <td class="py-3.5 px-4 text-emerald-400 font-semibold">${w.leniencyRate}%</td>
                <td class="py-3.5 px-4 text-amber-400 font-semibold">${w.strictnessRate}%</td>
                <td class="py-3.5 px-4 ${w.anomalyCount > 0 ? 'text-rose-400 font-bold' : 'text-slate-500'}">${w.anomalyCount}</td>
                <td class="py-3.5 px-4 font-extrabold text-sm text-white">${w.rai}%</td>
                <td class="py-3.5 px-4 font-sans">
                    <span class="px-2.5 py-1 text-[10px] font-bold rounded-full border ${badgeClass}">
                        ${statusText}
                    </span>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

// Render Panel Kontrol Checklist di Bawah Grafik (Tanpa Teks Coret)
    function renderChartControls() {
        const container = document.getElementById('chartControlsBelow');
        if (!container) return;

        let wasitBadgesHTML = '';
        for (let i = 0; i < 5; i++) {
            const isChecked = state.visibleWasit[i];
            const wasitName = state.wasitNames[i] || `Wasit ${i + 1}`;
            const color = CONFIG.colors.wasit[i];

            const activeClass = isChecked 
                ? `bg-slate-800 border-slate-600 text-white shadow-sm` 
                : `bg-slate-950/60 border-slate-800 text-slate-500 opacity-60`;

            const iconHTML = isChecked 
                ? `<span class="w-3.5 h-3.5 rounded flex items-center justify-center text-[10px] text-white font-black" style="background-color: ${color}">✓</span>`
                : `<span class="w-3.5 h-3.5 rounded border border-slate-700 bg-slate-900"></span>`;

            wasitBadgesHTML += `
                <button type="button" onclick="MASS_ANALISA.toggleWasit(${i})" class="flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all hover:border-slate-500 ${activeClass}">
                    ${iconHTML}
                    <span style="${isChecked ? `color: ${color}` : ''}">${wasitName}</span>
                </button>
            `;
        }

        container.innerHTML = `
            <div class="flex flex-wrap items-center justify-between gap-3 text-xs">
                <!-- Sakelar Jenis Garis (Total vs Teknik) -->
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-slate-400 font-bold uppercase text-[10px] mr-1">Tampilkan Garis:</span>
                    <button type="button" onclick="MASS_ANALISA.toggleMetric('total')" class="flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold transition ${state.showTotalLines ? 'bg-cyan-950 border-cyan-500/60 text-cyan-300' : 'bg-slate-950 border-slate-800 text-slate-500'}">
                        <span>${state.showTotalLines ? '✓' : '□'}</span> Nilai Total (Solid)
                    </button>
                    <button type="button" onclick="MASS_ANALISA.toggleMetric('tech')" class="flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold transition ${state.showTechLines ? 'bg-amber-950 border-amber-500/60 text-amber-300' : 'bg-slate-950 border-slate-800 text-slate-500'}">
                        <span>${state.showTechLines ? '✓' : '□'}</span> Nilai Teknik (Dashed)
                    </button>
                    <button type="button" onclick="MASS_ANALISA.toggleMetric('baseline')" class="flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold transition ${state.showBaseline ? 'bg-slate-800 border-slate-600 text-white' : 'bg-slate-950 border-slate-800 text-slate-500'}">
                        <span>${state.showBaseline ? '✓' : '□'}</span> Baseline Konsensus
                    </button>
                </div>
            </div>
            <!-- Checklist Wasit 1 - 5 -->
            <div class="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60">
                <span class="text-slate-400 font-bold uppercase text-[10px] mr-1">Filter Wasit:</span>
                ${wasitBadgesHTML}
            </div>
        `;
    }

    // 5. CHART.JS DENGAN DUAL Y-AXIS (Total: Sumbu Kiri 80-95, Teknik: Sumbu Kanan 45-65)
    function renderTrendChart() {
        const canvas = document.getElementById('wasitTrendChart');
        if (!canvas || typeof Chart === 'undefined') return;
        const ctx = canvas.getContext('2d');

        renderChartControls(); // Gambar tombol checklist di bawah grafik

        if (state.chartInstance) {
            state.chartInstance.destroy();
        }

        if (state.filteredEntries.length === 0) return;

        const labels = state.filteredEntries.map((e, i) => {
            const shortName = (e.peserta || '').split('&')[0].split('(')[0].trim().split(' ')[0];
            const prefix = e.matchType === 'H2H' ? e.gameNum : `#${i + 1}`;
            return `${prefix} ${shortName}`;
        });

        const datasets = [];

        // 1. DATASET NILAI TOTAL 5 WASIT (Sumbu Kiri 'y', Garis Solid)
        for (let i = 0; i < 5; i++) {
            const isVisible = state.showTotalLines && state.visibleWasit[i];
            datasets.push({
                label: `${state.wasitNames[i] || `Wasit ${i + 1}`} (Total)`,
                data: state.filteredEntries.map(e => e.scores[i] || 0),
                yAxisID: 'y',
                borderColor: CONFIG.colors.wasit[i],
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: isVisible ? 4 : 0,
                tension: 0.2,
                hidden: !isVisible
            });
        }

        // 2. DATASET NILAI TEKNIK 5 WASIT (Sumbu Kanan 'y1', Garis Dashed [5, 4])
        for (let i = 0; i < 5; i++) {
            const isVisible = state.showTechLines && state.visibleWasit[i];
            datasets.push({
                label: `${state.wasitNames[i] || `Wasit ${i + 1}`} (Teknik)`,
                data: state.filteredEntries.map(e => (e.techScores && e.techScores[i]) ? e.techScores[i] : 0),
                yAxisID: 'y1',
                borderColor: CONFIG.colors.wasit[i],
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                borderDash: [5, 4],
                pointRadius: isVisible ? 3 : 0,
                tension: 0.2,
                hidden: !isVisible
            });
        }

        // 3. BASELINE KONSENSUS TOTAL (Putih Tebal Solid)
        if (state.showBaseline) {
            datasets.push({
                label: 'Consensus Total',
                data: state.filteredEntries.map(e => e.baseline),
                yAxisID: 'y',
                borderColor: CONFIG.colors.baseline,
                borderWidth: 2,
                pointRadius: 0,
                fill: false,
                tension: 0.2
            });

            // BASELINE KONSENSUS TEKNIK (Putih Tipis Dashed)
            datasets.push({
                label: 'Consensus Teknik',
                data: state.filteredEntries.map(e => e.baselineTech || 0),
                yAxisID: 'y1',
                borderColor: 'rgba(255, 255, 255, 0.7)',
                borderWidth: 1.5,
                borderDash: [6, 4],
                pointRadius: 0,
                fill: false,
                tension: 0.2
            });
        }

        state.chartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false }, // Legenda atas dimatikan, diganti checklist bawah
                    tooltip: {
                        backgroundColor: '#0f172a',
                        titleColor: '#f8fafc',
                        bodyColor: '#cbd5e1',
                        borderColor: '#334155',
                        borderWidth: 1,
                        padding: 10
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(51, 65, 85, 0.3)' },
                        ticks: { color: '#94a3b8', font: { size: 11 } }
                    },
                    // Sumbu Y Kiri: Rentang Fix Nilai Total (80 - 95)
                    y: {
                        type: 'linear',
                        position: 'left',
                        min: CONFIG.yTotalMin,
                        max: CONFIG.yTotalMax,
                        grid: { color: 'rgba(51, 65, 85, 0.3)' },
                        ticks: {
                            stepSize: 1,
                            color: '#38bdf8',
                            font: { size: 10 }
                        },
                        title: {
                            display: true,
                            text: 'Total Skor (80 - 95)',
                            color: '#38bdf8',
                            font: { size: 10, weight: 'bold' }
                        }
                    },
                    // Sumbu Y Kanan: Rentang Fix Nilai Teknik (45 - 65)
                    y1: {
                        type: 'linear',
                        position: 'right',
                        min: CONFIG.yTechMin,
                        max: CONFIG.yTechMax,
                        grid: { drawOnChartArea: false }, // Mencegah garis grid tabrakan
                        ticks: {
                            stepSize: 2,
                            color: '#f59e0b',
                            font: { size: 10 }
                        },
                        title: {
                            display: true,
                            text: 'Nilai Teknik (45 - 65)',
                            color: '#f59e0b',
                            font: { size: 10, weight: 'bold' }
                        }
                    }
                }
            }
        });
    }

   return {
        init: function () {
            initSystemAndFetch();

            const catEl = document.getElementById('filterKategori');
            const poolEl = document.getElementById('filterPool');
            const subEl = document.getElementById('filterSub');
            const btnRef = document.getElementById('btnRefresh');
            const btnUpload = document.getElementById('btnUploadJson');
            const inputJson = document.getElementById('inputJsonFile');

            if (catEl) {
                catEl.addEventListener('change', () => {
                    updateDynamicFilters();
                    applyFilterAndRender();
                });
            }
            if (poolEl) poolEl.addEventListener('change', applyFilterAndRender);
            if (subEl) subEl.addEventListener('change', applyFilterAndRender);
            if (btnRef) btnRef.addEventListener('click', initSystemAndFetch);

            // Handler Tombol & Input File Picker JSON
            if (btnUpload && inputJson) {
                btnUpload.addEventListener('click', () => {
                    inputJson.value = ''; // Reset file input
                    inputJson.click();
                });

                inputJson.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        handleJsonFileUpload(file);
                    }
                });
            }
        },

        toggleWasit: function (index) {
            state.visibleWasit[index] = !state.visibleWasit[index];
            renderTrendChart();
        },

        toggleMetric: function (type) {
            if (type === 'total') state.showTotalLines = !state.showTotalLines;
            if (type === 'tech') state.showTechLines = !state.showTechLines;
            if (type === 'baseline') state.showBaseline = !state.showBaseline;
            renderTrendChart();
        }
    };
})();

window.addEventListener('DOMContentLoaded', () => {
    MASS_ANALISA.init();
});
