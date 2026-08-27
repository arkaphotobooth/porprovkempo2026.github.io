// login.js - Dual-Route Authentication & Automatic SQLite Bootstrap
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// 1. Konfigurasi Resmi Firebase Cloud Project Hub
const gatewayHubConfig = {
    apiKey: "AIzaSyCu529GrIFkC-QXZjjst5mVacRo_nyHH8c",
    authDomain: "projecthubmass-kempo.firebaseapp.com",
    projectId: "projecthubmass-kempo",
    storageBucket: "projecthubmass-kempo.firebasestorage.app",
    messagingSenderId: "441174258010",
    appId: "1:441174258010:web:27fa2ad32f2284565e8363"
};

// Inisialisasi Instance Firestore Khusus Gateway
const gatewayApp = getApps().find(app => app.name === "gatewayHubApp") 
    || initializeApp(gatewayHubConfig, "gatewayHubApp");
const db = getFirestore(gatewayApp);

// DOM Elements
const loginForm = document.getElementById('loginForm');
const manifestForm = document.getElementById('manifestForm');
const loginBtn = document.getElementById('loginBtn');
const errorMessage = document.getElementById('errorMessage');

// Toggle Tab Jalur (Online Cloud vs Offline Manifest)
const tabOnline = document.getElementById('tabOnline');
const tabOffline = document.getElementById('tabOffline');

if (tabOnline && tabOffline) {
    tabOnline.onclick = () => {
        tabOnline.classList.add('active');
        tabOffline.classList.remove('active');
        if (loginForm) loginForm.style.display = 'block';
        if (manifestForm) manifestForm.style.display = 'none';
        if (errorMessage) errorMessage.style.display = 'none';
    };

    tabOffline.onclick = () => {
        tabOffline.classList.add('active');
        tabOnline.classList.remove('active');
        if (loginForm) loginForm.style.display = 'none';
        if (manifestForm) manifestForm.style.display = 'block';
        if (errorMessage) errorMessage.style.display = 'none';
    };
}

// =========================================================================
// 2. JALUR ONLINE CLOUD SSO (DYNAMIC TENANT PROVISIONING)
// =========================================================================
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const eventIdInput = document.getElementById('eventId').value.trim().toUpperCase();
        const usernameInput = document.getElementById('username').value.trim();
        const passwordInput = document.getElementById('password').value.trim();

        loginBtn.textContent = 'Memvalidasi Lisensi & Cloud...';
        loginBtn.disabled = true;
        errorMessage.style.display = 'none';

        try {
            // A. Ambil Data Event dari Firestore Project Hub
            const qEvent = query(collection(db, "event_proposals"), where("id", "==", eventIdInput));
            const eventSnap = await getDocs(qEvent);

            if (eventSnap.empty) {
                showError(`Nomor Registrasi Event '${eventIdInput}' tidak ditemukan di Project Hub.`);
                return;
            }

            const eventData = eventSnap.docs[0].data();

            // Validasi Status Approval Super Admin
            if (eventData.status !== 'approved') {
                showError(`Turnamen '${eventData.name}' belum disetujui Super Admin (Status: ${(eventData.status || 'pending').toUpperCase()}).`);
                return;
            }

            // Validasi Sandi Sederhana
            if (passwordInput.length < 3) {
                showError("Kata sandi minimal 3 karakter.");
                return;
            }

            // B. Injeksi Otomatis ke Backend Lokal SQLite (/api/config)
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    eventName: eventData.name,
                    eventDate: eventData.dateStart,
                    eventLocation: `${eventData.location}, ${eventData.city}`
                })
            });

            // C. INJEKSI CONFIG JARINGAN & SERVER CLOUD (/api/network)
        // Membaca otomatis baik dari root map maupun serverConfig
        const targetRtdb = (eventData.serverConfig && eventData.serverConfig.rtdbConfig) 
            || eventData.rtdbConfig 
            || {};

        const targetFirestore = (eventData.serverConfig && eventData.serverConfig.firestoreConfig) 
            || eventData.firestoreConfig 
            || {};

        await fetch('/api/network', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode: eventData.networkMode || 'hybrid',
                rtdb_config: targetRtdb,
                firestore_config: targetFirestore
            })
        });

            // D. Simpan Sesi Login Lokal
            sessionStorage.setItem('isLoggedIn', 'true');
            sessionStorage.setItem('username', usernameInput);
            sessionStorage.setItem('activeEventId', eventData.id);
            sessionStorage.setItem('activeEventName', eventData.name);

            // Tentukan Peran Pengguna
            let userRole = 'seksi_pertandingan';
            if (usernameInput.startsWith('court_') || usernameInput.includes('panitera')) {
                userRole = 'panitera';
                sessionStorage.setItem('courtId', usernameInput);
            } else if (usernameInput.includes('acara')) {
                userRole = 'seksi_acara';
            }
            sessionStorage.setItem('role', userRole);

            // Redirect ke Halaman Tujuan
            redirectRole(userRole);

        } catch (error) {
            console.error("Error validasi login:", error);
            showError("Gagal terhubung ke Project Hub Cloud: " + error.message);
        } finally {
            loginBtn.textContent = 'Masuk & Sinkronkan';
            loginBtn.disabled = false;
        }
    });
}

// =========================================================================
// 3. JALUR OFFLINE LAN (INGESTION EVENT-MANIFEST.JSON)
// =========================================================================
let parsedManifestData = null;
const dropzone = document.getElementById('dropzoneManifest');
const fileInput = document.getElementById('manifestFileInput');
const btnManifestSubmit = document.getElementById('btnManifestSubmit');
const manifestInfo = document.getElementById('manifestInfo');

if (dropzone && fileInput) {
    dropzone.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                parsedManifestData = JSON.parse(event.target.result);
                if (manifestInfo) {
                    manifestInfo.style.display = 'block';
                    manifestInfo.innerHTML = `
                        <b>${parsedManifestData.event_info.name}</b><br>
                        Mode: ${(parsedManifestData.network.mode || 'Lokal').toUpperCase()} | Kuota: ${parsedManifestData.license.max_courts} Court
                    `;
                }
                if (btnManifestSubmit) btnManifestSubmit.disabled = false;
            } catch (err) {
                alert("File manifest JSON tidak valid atau rusak.");
            }
        };
        reader.readAsText(file);
    };
}

if (manifestForm) {
    manifestForm.onsubmit = async (e) => {
        e.preventDefault();
        if (!parsedManifestData) return;

        try {
            // Suntik Identitas Event
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    eventName: parsedManifestData.event_info.name,
                    eventDate: parsedManifestData.event_info.date_start,
                    eventLocation: `${parsedManifestData.event_info.location}, ${parsedManifestData.event_info.city}`
                })
            });

            // Suntik Config Jaringan
            await fetch('/api/network', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: parsedManifestData.network.mode || 'lokal',
                    rtdb_config: parsedManifestData.network.rtdb_config || {},
                    firestore_config: parsedManifestData.network.firestore_config || {}
                })
            });

            sessionStorage.setItem('isLoggedIn', 'true');
            sessionStorage.setItem('role', 'seksi_pertandingan');
            sessionStorage.setItem('username', 'admin_offline');
            sessionStorage.setItem('activeEventName', parsedManifestData.event_info.name);

            window.location.href = './dashboard.html';

        } catch (err) {
            alert("Gagal menyuntikkan data manifest ke SQLite lokal: " + err.message);
        }
    };
}

// =========================================================================
// 4. HELPER FUNCTIONS & AUTO-REDIRECT
// =========================================================================
function redirectRole(role) {
    if (role === 'panitera') {
        window.location.href = './scoring/index.html';
    } else if (role === 'seksi_acara') {
        window.location.href = './jadwal/index.html';
    } else {
        window.location.href = './dashboard.html';
    }
}

function showError(message) {
    if (errorMessage) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
    }
}

window.onload = () => {
    if (sessionStorage.getItem('isLoggedIn') === 'true') {
        const role = sessionStorage.getItem('role');
        redirectRole(role);
    }
};