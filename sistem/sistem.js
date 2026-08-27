// sistem.js
document.addEventListener('DOMContentLoaded', () => {
    // =========================================================
    // 1. LOGIKA PERPINDAHAN TAB
    // =========================================================
    const tabLinks = document.querySelectorAll('.tab-link');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            // Hapus kelas active dari semua
            tabLinks.forEach(l => l.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            // Tambah kelas active ke yang diklik
            link.classList.add('active');
            const targetId = link.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');
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
                eventName: document.getElementById('eventName').value,
                eventDate: document.getElementById('eventDate').value,
                eventLocation: document.getElementById('eventLocation').value
            };

            try {
                // Pastikan endpoint menggunakan absolute URL agar konsisten
                const response = await fetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(eventData)
                });

                if (response.ok) {
                    alert('Identitas Event Berhasil Disimpan!');
                }
            } catch (error) {
                alert('Gagal menyimpan. Pastikan server lokal (Node.js) berjalan.');
            }
        });
    }

    // =========================================================
    // 4. LOGIKA SIMPAN KONFIGURASI JARINGAN (SMART PASTE)
    // =========================================================

    // Fungsi Pintar untuk mengekstrak { object } dari copy-paste
    function extractConfig(rawText) {
        if (!rawText || rawText.trim() === "") return {}; // Jika kosong, kembalikan objek kosong
        try {
            const startIndex = rawText.indexOf('{');
            const endIndex = rawText.lastIndexOf('}');
            if (startIndex === -1 || endIndex === -1) throw new Error("Kurung kurawal {} tidak ditemukan");

            const objectString = rawText.substring(startIndex, endIndex + 1);
            // Mengubah format string JS (walau tanpa tanda kutip ganda) menjadi Object murni
            return new Function('return ' + objectString)();
        } catch (error) {
            console.error("Gagal mengekstrak config:", error);
            return null; // Menandakan ada yang salah format
        }
    }

    const btnSimpanJaringan = document.getElementById('btnSimpanJaringan');
    if (btnSimpanJaringan) {
        btnSimpanJaringan.addEventListener('click', async (e) => {
            e.preventDefault();

            const rtdbRaw = document.getElementById('rtdb_raw').value;
            const fsRaw = document.getElementById('fs_raw').value;

            // Ekstrak data dari kolom paste
            const rtdbConfig = extractConfig(rtdbRaw);
            const firestoreConfig = extractConfig(fsRaw);

            // Validasi jika format salah
            if (rtdbConfig === null || firestoreConfig === null) {
                alert("Format salah! Pastikan Anda mem-paste kode yang mengandung kurung kurawal { ... } dengan benar.");
                return;
            }

            const originalText = btnSimpanJaringan.innerHTML;
            btnSimpanJaringan.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
            btnSimpanJaringan.disabled = true;

            const payload = {
                mode: document.getElementById('netMode').value,
                rtdb_config: rtdbConfig,
                firestore_config: firestoreConfig
            };

            try {
                const response = await fetch('/api/network', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();
                alert(result.message || 'Pengaturan Database & Jaringan Berhasil Diterapkan!');
            } catch (error) {
                console.error("Error Simpan Jaringan:", error);
                alert("Gagal menyambung ke Mesin Lokal (Node.js).");
            } finally {
                btnSimpanJaringan.innerHTML = originalText;
                btnSimpanJaringan.disabled = false;
            }
        });
    }
    // =========================================================
    // LOGIKA TARIK DATA CLOUD KE LOKAL (TAB DATABASE)
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
                // 1. Ambil config Firebase dari backend lokal
                const netRes = await fetch('/api/network');
                const netData = await netRes.json();

                if (!netData.rtdb_config || Object.keys(netData.rtdb_config).length === 0) {
                    alert("GAGAL: Konfigurasi Firebase (RTDB) kosong. Silakan isi di tab 'Jaringan' terlebih dahulu.");
                    return;
                }

                // 2. Inisialisasi Firebase sementara (jika belum ada)
                if (!firebase.apps.length) {
                    firebase.initializeApp(netData.rtdb_config);
                }
                const tempDatabase = firebase.database();

                // 3. Tarik data dari Cloud (sekali jalan)
                const snapshot = await tempDatabase.ref('turnamen_data').once('value');

                if (!snapshot.exists()) {
                    alert("GAGAL: Data di Cloud Firebase masih kosong.");
                    return;
                }

                const cloudData = snapshot.val();

                // 4. Kirim data yang didapat ke backend lokal SQLite
                const saveRes = await fetch('/api/data_turnamen', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(cloudData)
                });

                if (saveRes.ok) {
                    alert("SUKSES! Data dari Cloud berhasil diunduh dan diamankan di database laptop ini (SQLite).");
                } else {
                    alert("Terjadi kesalahan saat menyimpan data ke SQLite.");
                }

            } catch (error) {
                console.error("Gagal menarik data:", error);
                alert("Terjadi kesalahan! Pastikan Anda terhubung ke internet dan konfigurasi jaringan valid.");
            } finally {
                // Kembalikan tombol ke kondisi semula
                btnTarikCloud.innerHTML = originalText;
                btnTarikCloud.disabled = false;
            }
        });
    }
});

// =========================================================
// 5. FUNGSI PENDUKUNG (Diluar DOMContentLoaded)
// =========================================================

// Fungsi mengambil data dari Server Node.js
async function loadEventConfig() {
    try {
        const response = await fetch('/api/config');
        if (response.ok) {
            const data = await response.json();
            if (document.getElementById('eventName')) document.getElementById('eventName').value = data.eventName || '';
            if (document.getElementById('eventDate')) document.getElementById('eventDate').value = data.eventDate || '';
            if (document.getElementById('eventLocation')) document.getElementById('eventLocation').value = data.eventLocation || '';
        }
    } catch (error) {
        console.log("Menggunakan database lokal default, pastikan server Node.js menyala.");
    }
}

// Fungsi Load Data Jaringan Saat Dibuka
async function loadNetworkConfig() {
    try {
        const response = await fetch('/api/network');
        if (response.ok) {
            const data = await response.json();

            if (data) {
                if (document.getElementById('netMode')) document.getElementById('netMode').value = data.mode || 'lokal';

                // =========================================================
                // PASTIKAN KODE INI ADA DI SISTEM.JS ANDA
                // =========================================================
                const ipElement = document.getElementById('ipAddressDisplay');
                if (ipElement) {
                    ipElement.innerText = data.ip_address || 'IP Tidak Terdeteksi';
                }

                // Tulis ulang JSON menjadi format Copy-Paste di Textarea RTDB
                if (data.rtdb_config && Object.keys(data.rtdb_config).length > 0) {
                    const rtdbText = "const rtdbConfig = " + JSON.stringify(data.rtdb_config, null, 4) + ";";
                    if (document.getElementById('rtdb_raw')) document.getElementById('rtdb_raw').value = rtdbText;
                }

                // Tulis ulang JSON menjadi format Copy-Paste di Textarea Firestore
                if (data.firestore_config && Object.keys(data.firestore_config).length > 0) {
                    const fsText = "const firestoreConfig = " + JSON.stringify(data.firestore_config, null, 4) + ";";
                    if (document.getElementById('fs_raw')) document.getElementById('fs_raw').value = fsText;
                }
            }
        }
    } catch (error) {
        console.error("Gagal memuat data jaringan:", error);
    }
}

// =========================================================
// LOGIKA DORONG DATA LOKAL KE CLOUD (BACKUP FIREBASE)
// =========================================================
const btnPushCloud = document.getElementById('btnPushCloud');

if (btnPushCloud) {
    btnPushCloud.addEventListener('click', async (e) => {
        e.preventDefault();

        const konfirmasi = confirm(
            "PERINGATAN KRITIS!\n\n" +
            "Tindakan ini akan menyedot SEMUA data dari database laptop ini (SQLite) dan MENIMPA data di Cloud (Firebase).\n" +
            "Data lama di Cloud akan tertimpa sepenuhnya.\n\n" +
            "Apakah Anda yakin ingin mem-backup data ke Cloud sekarang?"
        );

        if (!konfirmasi) return;

        const originalText = btnPushCloud.innerHTML;
        btnPushCloud.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sedang Mendorong Data...';
        btnPushCloud.disabled = true;

        try {
            // 1. Ambil config Firebase dari backend lokal
            const netRes = await fetch('/api/network');
            const netData = await netRes.json();

            if (!netData.rtdb_config || Object.keys(netData.rtdb_config).length === 0) {
                alert("GAGAL: Konfigurasi Firebase (RTDB) kosong. Silakan isi di tab 'Jaringan' terlebih dahulu.");
                return;
            }

            // 2. Inisialisasi Firebase sementara (jika belum ada)
            if (!firebase.apps.length) {
                firebase.initializeApp(netData.rtdb_config);
            }
            const tempDatabase = firebase.database();

            // 3. Ambil data MASTER dari SQLite Lokal
            const localRes = await fetch('/api/data_turnamen');
            if (!localRes.ok) throw new Error("Gagal mengambil data dari database lokal (SQLite).");
            const localData = await localRes.json();

            // 4. Tembakkan ke Firebase Cloud!
            await tempDatabase.ref('turnamen_data').set({
                categories: localData.categories || [],
                participants: localData.participants || [],
                matches: localData.matches || [],
                barcodes: localData.barcodes || [],
                settings: localData.settings || {},
                rundown_state: { schedule: localData.rundown || [] }
            });

            alert("✅ SUKSES! Seluruh data lokal berhasil diamankan (di-backup) ke Cloud Firebase.");

        } catch (error) {
            console.error("Gagal push data:", error);
            alert("Terjadi kesalahan! Pastikan Anda terhubung ke internet dan konfigurasi jaringan valid.\nError: " + error.message);
        } finally {
            // Kembalikan tombol ke kondisi semula
            btnPushCloud.innerHTML = originalText;
            btnPushCloud.disabled = false;
        }
    });
}