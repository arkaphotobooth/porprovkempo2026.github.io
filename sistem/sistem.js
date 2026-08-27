import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, query, where, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const gatewayConfig = {
    apiKey: "AIzaSyCu529GrIFkC-QXZjjst5mVacRo_nyHH8c",
    authDomain: "projecthubmass-kempo.firebaseapp.com",
    projectId: "projecthubmass-kempo",
    storageBucket: "projecthubmass-kempo.firebasestorage.app",
    messagingSenderId: "441174258010",
    appId: "1:441174258010:web:27fa2ad32f2284565e8363"
};

const app = getApps().find(a => a.name === "gatewayHubApp") || initializeApp(gatewayConfig, "gatewayHubApp");
const db = getFirestore(app);

const isCloud = window.location.hostname.includes('github.io') || window.location.hostname.includes('netlify.app');

function getActiveSession() {
    const raw = localStorage.getItem('mass_kempo_session');
    return raw ? JSON.parse(raw) : null;
}

// sistem.js - Adaptor Otomatis: Cloud (Netlify / Firebase) & Lokal (Node.js / SQLite)
document.addEventListener('DOMContentLoaded', () => {
    // =========================================================
    // 0. DETEKSI LINGKUNGAN & PEMBACAAN SESI LOGIN OTOMATIS
    // =========================================================
    const isCloud = window.location.hostname.includes('netlify.app') || 
                    (!window.location.hostname.includes('localhost') && 
                     !window.location.hostname.startsWith('192.168.') && 
                     !window.location.hostname.startsWith('127.0.0.1'));

    function getActiveSession() {
        const raw = localStorage.getItem('mass_kempo_session');
        if (raw) {
            try { return JSON.parse(raw); } catch (e) { }
        }
        return null;
    }

    function saveActiveSession(updatedData) {
        const current = getActiveSession() || {};
        const merged = { ...current, ...updatedData };
        localStorage.setItem('mass_kempo_session', JSON.stringify(merged));
    }

    // =========================================================
    // 1. LOGIKA PERPINDAHAN TAB
    // =========================================================
    const tabLinks = document.querySelectorAll('.tab-link');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            tabLinks.forEach(l => l.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            link.classList.add('active');
            const targetId = link.getAttribute('data-target');
            const targetPane = document.getElementById(targetId);
            if (targetPane) targetPane.classList.add('active');
        });
    });

    // =========================================================
    // 2. LOAD DATA SAAT HALAMAN DIBUKA
    // =========================================================
    loadEventConfig();
    loadNetworkConfig();

    // =========================================================
    // 3. LOGIKA SIMPAN IDENTITAS EVENT
    // =========================================================
    const formEvent = document.getElementById('formEvent');
    if (formEvent) {
        formEvent.addEventListener('submit', async (e) => {
            e.preventDefault();
            const eventData = {
                eventName: document.getElementById('eventName').value.trim(),
                eventDate: document.getElementById('eventDate').value,
                eventLocation: document.getElementById('eventLocation').value.trim()
            };

            if (isCloud) {
                const session = getActiveSession();
                if (session && session.eventId) {
                    try {
                        const q = query(collection(db, "event_proposals"), where("id", "==", session.eventId));
                        const snap = await getDocs(q);
                        if (!snap.empty) {
                            await updateDoc(doc(db, "event_proposals", snap.docs[0].id), {
                                name: eventData.eventName,
                                dateStart: eventData.eventDate,
                                location: eventData.eventLocation,
                                updatedAt: new Date().toISOString()
                            });
                        }
                        session.name = eventData.eventName;
                        session.eventName = eventData.eventName;
                        localStorage.setItem('mass_kempo_session', JSON.stringify(session));
                        alert('✅ Profil Event Berhasil Disimpan & Disinkronkan ke Cloud!');
                    } catch (err) {
                        alert('Gagal simpan ke Cloud: ' + err.message);
                    }
                }
            } else {
                try {
                    const response = await fetch('/api/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(eventData)
                    });
                    if (response.ok) alert('Identitas Event Berhasil Disimpan!');
                } catch (error) {
                    alert('Gagal menyimpan ke server lokal.');
                }
            }
        });
    }

    // =========================================================
    // 4. LOGIKA SIMPAN KONFIGURASI JARINGAN (SMART PASTE)
    // =========================================================
    function extractConfig(rawText) {
        if (!rawText || rawText.trim() === "") return {};
        try {
            const startIndex = rawText.indexOf('{');
            const endIndex = rawText.lastIndexOf('}');
            if (startIndex === -1 || endIndex === -1) throw new Error("Kurung kurawal {} tidak ditemukan");

            const objectString = rawText.substring(startIndex, endIndex + 1);
            return new Function('return ' + objectString)();
        } catch (error) {
            console.error("Gagal mengekstrak config:", error);
            return null;
        }
    }

    const btnSimpanJaringan = document.getElementById('btnSimpanJaringan');
    if (btnSimpanJaringan) {
        btnSimpanJaringan.addEventListener('click', async (e) => {
            e.preventDefault();

            const rtdbRaw = document.getElementById('rtdb_raw').value;
            const fsRaw = document.getElementById('fs_raw').value;

            const rtdbConfig = extractConfig(rtdbRaw);
            const firestoreConfig = extractConfig(fsRaw);

            if (rtdbConfig === null || firestoreConfig === null) {
                alert("Format salah! Pastikan Anda mem-paste kode yang mengandung kurung kurawal { ... } dengan benar.");
                return;
            }

            const originalText = btnSimpanJaringan.innerHTML;
            btnSimpanJaringan.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
            btnSimpanJaringan.disabled = true;

            const mode = document.getElementById('netMode').value;

            if (isCloud) {
                const session = getActiveSession();
                if (session && session.eventId) {
                    try {
                        // 1. Update ke Cloud Firestore agar semua laptop panitera terupdate
                        const q = query(collection(db, "event_proposals"), where("id", "==", session.eventId));
                        const snap = await getDocs(q);
                        if (!snap.empty) {
                            await updateDoc(doc(db, "event_proposals", snap.docs[0].id), {
                                networkMode: mode,
                                serverConfig: { rtdbConfig, firestoreConfig },
                                updatedAt: new Date().toISOString()
                            });
                        }

                        // 2. Update local storage laptop ini
                        session.networkMode = mode;
                        session.serverConfig = { rtdbConfig, firestoreConfig };
                        localStorage.setItem('mass_kempo_session', JSON.stringify(session));

                        alert('✅ SUKSES! Konfigurasi Jaringan Tersimpan di Cloud.\nSemua laptop panitera otomatis terkonfigurasi!');
                    } catch (err) {
                        alert('Gagal memperbarui ke Cloud: ' + err.message);
                    } finally {
                        btnSimpanJaringan.innerHTML = originalText;
                        btnSimpanJaringan.disabled = false;
                    }
                }
            } else {
                const payload = { mode, rtdb_config: rtdbConfig, firestore_config: firestoreConfig };
                try {
                    const response = await fetch('/api/network', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const result = await response.json();
                    alert(result.message || 'Pengaturan Database & Jaringan Berhasil Diterapkan!');
                } catch (error) {
                    alert("Gagal menyambung ke server lokal.");
                } finally {
                    btnSimpanJaringan.innerHTML = originalText;
                    btnSimpanJaringan.disabled = false;
                }
            }
        });
    }

    // =========================================================
    // 5. LOGIKA TARIK DATA CLOUD KE LOKAL (TAB DATABASE)
    // =========================================================
    const btnTarikCloud = document.getElementById('btnTarikCloud');
    if (btnTarikCloud) {
        btnTarikCloud.addEventListener('click', async (e) => {
            e.preventDefault();

            const konfirmasi = confirm(
                "PERINGATAN!\n\n" +
                "Tindakan ini akan menarik data dari Cloud dan MENIMPA data lokal di laptop ini.\n" +
                "Pastikan tidak ada pertandingan yang sedang berjalan agar nilainya tidak hilang.\n\n" +
                "Apakah Anda yakin ingin melanjutkan?"
            );

            if (!konfirmasi) return;

            const originalText = btnTarikCloud.innerHTML;
            btnTarikCloud.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sedang Menarik Data...';
            btnTarikCloud.disabled = true;

            try {
                let rtdbConfig = null;

                if (isCloud) {
                    const session = getActiveSession();
                    rtdbConfig = session?.serverConfig?.rtdbConfig;
                } else {
                    const netRes = await fetch('/api/network');
                    const netData = await netRes.json();
                    rtdbConfig = netData.rtdb_config;
                }

                if (!rtdbConfig || Object.keys(rtdbConfig).length === 0) {
                    alert("GAGAL: Konfigurasi Firebase (RTDB) kosong. Silakan isi di tab 'Jaringan' terlebih dahulu.");
                    return;
                }

                if (typeof firebase !== 'undefined' && !firebase.apps.length) {
                    firebase.initializeApp(rtdbConfig);
                }
                const tempDatabase = firebase.database();

                const snapshot = await tempDatabase.ref('turnamen_data').once('value');

                if (!snapshot.exists()) {
                    alert("GAGAL: Data di Cloud Firebase masih kosong.");
                    return;
                }

                const cloudData = snapshot.val();

                if (isCloud) {
                    localStorage.setItem('mass_kempo_master_data', JSON.stringify(cloudData));
                    alert("SUKSES! Data Cloud berhasil diunduh ke penyimpanan browser lokal.");
                } else {
                    const saveRes = await fetch('/api/data_turnamen', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(cloudData)
                    });

                    if (saveRes.ok) {
                        alert("SUKSES! Data dari Cloud berhasil diunduh dan diamankan di database SQLite lokal.");
                    } else {
                        alert("Terjadi kesalahan saat menyimpan data ke SQLite.");
                    }
                }

            } catch (error) {
                console.error("Gagal menarik data:", error);
                alert("Terjadi kesalahan! Pastikan konfigurasi jaringan RTDB valid.\nError: " + error.message);
            } finally {
                btnTarikCloud.innerHTML = originalText;
                btnTarikCloud.disabled = false;
            }
        });
    }

    // =========================================================
    // 6. LOGIKA PUSH DATA KE CLOUD
    // =========================================================
    const btnPushCloud = document.getElementById('btnPushCloud');
    if (btnPushCloud) {
        btnPushCloud.addEventListener('click', async (e) => {
            e.preventDefault();

            const konfirmasi = confirm(
                "PERINGATAN KRITIS!\n\n" +
                "Tindakan ini akan mem-backup data ke Cloud (Firebase).\n" +
                "Apakah Anda yakin ingin melanjutkan?"
            );

            if (!konfirmasi) return;

            const originalText = btnPushCloud.innerHTML;
            btnPushCloud.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sedang Mendorong Data...';
            btnPushCloud.disabled = true;

            try {
                let rtdbConfig = null;

                if (isCloud) {
                    const session = getActiveSession();
                    rtdbConfig = session?.serverConfig?.rtdbConfig;
                } else {
                    const netRes = await fetch('/api/network');
                    const netData = await netRes.json();
                    rtdbConfig = netData.rtdb_config;
                }

                if (!rtdbConfig || Object.keys(rtdbConfig).length === 0) {
                    alert("GAGAL: Konfigurasi Firebase (RTDB) kosong. Silakan isi di tab 'Jaringan' terlebih dahulu.");
                    return;
                }

                if (typeof firebase !== 'undefined' && !firebase.apps.length) {
                    firebase.initializeApp(rtdbConfig);
                }
                const tempDatabase = firebase.database();

                let masterData = {};
                if (isCloud) {
                    masterData = JSON.parse(localStorage.getItem('mass_kempo_master_data') || '{}');
                } else {
                    const localRes = await fetch('/api/data_turnamen');
                    if (!localRes.ok) throw new Error("Gagal mengambil data dari database lokal (SQLite).");
                    masterData = await localRes.json();
                }

                await tempDatabase.ref('turnamen_data').set({
                    categories: masterData.categories || [],
                    participants: masterData.participants || [],
                    matches: masterData.matches || [],
                    barcodes: masterData.barcodes || [],
                    settings: masterData.settings || {},
                    rundown_state: { schedule: masterData.rundown || [] },
                    updatedAt: new Date().toISOString()
                });

                alert("✅ SUKSES! Seluruh data berhasil diamankan (di-backup) ke Cloud Firebase.");

            } catch (error) {
                console.error("Gagal push data:", error);
                alert("Terjadi kesalahan! Error: " + error.message);
            } finally {
                btnPushCloud.innerHTML = originalText;
                btnPushCloud.disabled = false;
            }
        });
    }

    // =========================================================
    // 7. FUNGSI PEMUAT DATA (HYDRATION ENGINE)
    // =========================================================
    async function loadEventConfig() {
    if (isCloud) {
        const session = getActiveSession();
        if (session) {
            if (document.getElementById('eventName')) document.getElementById('eventName').value = session.eventName || session.name || '';
            if (document.getElementById('eventDate')) document.getElementById('eventDate').value = session.dateStart || '';
            if (document.getElementById('eventLocation')) document.getElementById('eventLocation').value = session.location || '';
        }
        return;
    }
    try {
        const response = await fetch('/api/config');
        if (response.ok) {
            const data = await response.json();
            if (document.getElementById('eventName')) document.getElementById('eventName').value = data.eventName || '';
            if (document.getElementById('eventDate')) document.getElementById('eventDate').value = data.eventDate || '';
            if (document.getElementById('eventLocation')) document.getElementById('eventLocation').value = data.eventLocation || '';
        }
    } catch (e) { }
}

async function loadNetworkConfig() {
    const ipElement = document.getElementById('ipAddressDisplay');

    if (isCloud) {
        const session = getActiveSession();
        if (ipElement) {
            ipElement.parentElement.innerHTML = `<i class="fas fa-cloud text-success"></i> <b>${window.location.origin}</b> (Mode Cloud Server Aktif)`;
        }
        if (session) {
            if (document.getElementById('netMode')) document.getElementById('netMode').value = session.networkMode || 'firebase';
            if (session.serverConfig?.rtdbConfig) {
                document.getElementById('rtdb_raw').value = "const rtdbConfig = " + JSON.stringify(session.serverConfig.rtdbConfig, null, 4) + ";";
            }
            if (session.serverConfig?.firestoreConfig) {
                document.getElementById('fs_raw').value = "const firestoreConfig = " + JSON.stringify(session.serverConfig.firestoreConfig, null, 4) + ";";
            }
        }
        return;
    }

    try {
        const response = await fetch('/api/network');
        if (response.ok) {
            const data = await response.json();
            if (document.getElementById('netMode')) document.getElementById('netMode').value = data.mode || 'lokal';
            if (ipElement) ipElement.innerText = data.ip_address || 'IP Tidak Terdeteksi';
            if (data.rtdb_config) document.getElementById('rtdb_raw').value = "const rtdbConfig = " + JSON.stringify(data.rtdb_config, null, 4) + ";";
            if (data.firestore_config) document.getElementById('fs_raw').value = "const firestoreConfig = " + JSON.stringify(data.firestore_config, null, 4) + ";";
        }
    } catch (e) {
            console.error("Gagal memuat data jaringan lokal:", error);
        }
    }
});
