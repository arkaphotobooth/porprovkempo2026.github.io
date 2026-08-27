// login.js - Dual-Route Authentication & Automatic Cloud Session Binding
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

const gatewayApp = getApps().find(app => app.name === "gatewayHubApp") 
    || initializeApp(gatewayHubConfig, "gatewayHubApp");
const db = getFirestore(gatewayApp);

const isCloud = window.location.hostname.includes('github.io') || 
                window.location.hostname.includes('netlify.app') || 
                (!window.location.hostname.includes('localhost') && 
                 !window.location.hostname.startsWith('192.168.') && 
                 !window.location.hostname.startsWith('127.0.0.1'));

// DOM Elements
const loginForm = document.getElementById('loginForm');
const manifestForm = document.getElementById('manifestForm');
const loginBtn = document.getElementById('loginBtn');
const errorMessage = document.getElementById('errorMessage');

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
// 2. JALUR ONLINE CLOUD SSO
// =========================================================================
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const eventIdInput = document.getElementById('eventId').value.trim().toUpperCase();
        const usernameInput = document.getElementById('username').value.trim();
        const passwordInput = document.getElementById('password').value.trim();

        loginBtn.textContent = 'Memvalidasi Lisensi & Cloud...';
        loginBtn.disabled = true;
        if (errorMessage) errorMessage.style.display = 'none';

        try {
            // A. Ambil Data Event dari Firestore Project Hub
            const qEvent = query(collection(db, "event_proposals"), where("id", "==", eventIdInput));
            const eventSnap = await getDocs(qEvent);

            if (eventSnap.empty) {
                showError(`Nomor Registrasi Event '${eventIdInput}' tidak ditemukan di Project Hub.`);
                return;
            }

            const eventDoc = eventSnap.docs[0];
            const eventData = eventDoc.data();

            // Validasi Status Approval Super Admin
            if (eventData.status !== 'approved') {
                showError(`Turnamen '${eventData.name}' belum disetujui Super Admin.`);
                return;
            }

            // B. TARIK KONFIGURASI SERVER DARI system_settings/server_clusters
            let targetRtdb = {};
            let targetFirestore = {};

            const assignedServerId = eventData.assignedServer || 'server_3';
            try {
                const clusterSnap = await getDocs(collection(db, "system_settings"));
                clusterSnap.forEach(docSnap => {
                    if (docSnap.id === 'server_clusters') {
                        const clusterData = docSnap.data();
                        const serverNode = clusterData[assignedServerId] || {};
                        targetRtdb = serverNode.rtdbConfig || serverNode.config || {};
                        targetFirestore = serverNode.firestoreConfig || {};
                    }
                });
            } catch (errCluster) {
                console.warn("Gagal mengambil server_clusters:", errCluster);
            }

            // Fallback jika tersimpan langsung di dokumen event
            if (Object.keys(targetRtdb).length === 0 && eventData.serverConfig) {
                targetRtdb = eventData.serverConfig.rtdbConfig || {};
                targetFirestore = eventData.serverConfig.firestoreConfig || {};
            }

            // C. SIMPAN SESI LENGKAP KE LOCALSTORAGE & SESSIONSTORAGE
            let userRole = 'seksi_pertandingan';
            if (usernameInput.startsWith('court_') || usernameInput.includes('panitera')) {
                userRole = 'panitera';
                sessionStorage.setItem('courtId', usernameInput);
            } else if (usernameInput.includes('acara')) {
                userRole = 'seksi_acara';
            }

            const sessionPayload = {
                isLoggedIn: true,
                role: userRole,
                username: usernameInput,
                eventId: eventData.id,
                eventName: eventData.name,
                name: eventData.name,
                dateStart: eventData.dateStart || '',
                location: `${eventData.location || ''}, ${eventData.city || ''}`,
                networkMode: eventData.networkMode || 'firebase',
                assignedServer: assignedServerId,
                categories: eventData.categories || [],
                serverConfig: {
                    rtdbConfig: targetRtdb,
                    firestoreConfig: targetFirestore
                }
            };

            localStorage.setItem('mass_kempo_session', JSON.stringify(sessionPayload));

            sessionStorage.setItem('isLoggedIn', 'true');
            sessionStorage.setItem('role', userRole);
            sessionStorage.setItem('username', usernameInput);
            sessionStorage.setItem('activeEventId', eventData.id);
            sessionStorage.setItem('activeEventName', eventData.name);

            // D. Redirect
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
// 3. JALUR OFFLINE LAN (MANIFEST)
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

        const sessionPayload = {
            isLoggedIn: true,
            role: 'seksi_pertandingan',
            username: 'admin_offline',
            eventId: parsedManifestData.event_info.id || 'OFFLINE-EVENT',
            eventName: parsedManifestData.event_info.name,
            name: parsedManifestData.event_info.name,
            dateStart: parsedManifestData.event_info.date_start || '',
            location: `${parsedManifestData.event_info.location || ''}, ${parsedManifestData.event_info.city || ''}`,
            networkMode: parsedManifestData.network.mode || 'lokal',
            serverConfig: {
                rtdbConfig: parsedManifestData.network.rtdb_config || {},
                firestoreConfig: parsedManifestData.network.firestore_config || {}
            }
        };

        localStorage.setItem('mass_kempo_session', JSON.stringify(sessionPayload));
        sessionStorage.setItem('isLoggedIn', 'true');
        sessionStorage.setItem('role', 'seksi_pertandingan');
        sessionStorage.setItem('username', 'admin_offline');
        sessionStorage.setItem('activeEventName', parsedManifestData.event_info.name);

        window.location.href = './dashboard.html';
    };
}

// =========================================================================
// 4. HELPER & REDIRECT
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
