// dashboard.js
import { db } from './assets/js/firebase-app.js';
import { collection, getDocs, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    // 1. Verifikasi Autentikasi
    const isLoggedIn = sessionStorage.getItem('isLoggedIn') || (localStorage.getItem('mass_kempo_session') ? 'true' : 'false');
    const role = sessionStorage.getItem('role');
    
    if (isLoggedIn !== 'true') {
        window.location.href = 'index.html';
        return;
    }

    // 2. Tampilkan Nama Event Aktif Secara Instan dari Storage
    renderActiveEventBadge();

    // 3. Jika di Server Lokal, coba sinkronisasi background
    const isCloud = window.location.hostname.includes('github.io') || window.location.hostname.includes('netlify.app');
    if (!isCloud) {
        fetch('/api/config')
            .then(res => res.json())
            .then(data => {
                if (data && data.eventName) {
                    updateEventUI(data.eventName, data.eventLocation);
                }
            })
            .catch(() => {});
    }
});

function renderActiveEventBadge() {
    let eventName = sessionStorage.getItem('activeEventName');
    let eventLocation = '';

    const rawSession = localStorage.getItem('mass_kempo_session');
    if (rawSession) {
        try {
            const parsed = JSON.parse(rawSession);
            eventName = parsed.eventName || parsed.name || eventName;
            eventLocation = parsed.location || '';
        } catch (e) { }
    }

    if (eventName) {
        updateEventUI(eventName, eventLocation);
    }
}

function updateEventUI(name, location) {
    // Cari elemen penampung teks event (baik id liveEventInfo atau teks memuat bawaan)
    let el = document.getElementById('liveEventInfo');
    if (!el) {
        el = Array.from(document.querySelectorAll('*')).find(e => 
            e.childNodes.length === 1 && e.textContent && e.textContent.includes('Memuat info event')
        );
    }

    if (el) {
        const locText = location ? ` (${location})` : '';
        el.innerHTML = `<i class="fas fa-trophy text-primary"></i> <b>${name}</b>${locText}`;
    }
}

document.getElementById('btnLogout')?.addEventListener('click', () => {
    sessionStorage.clear();
    localStorage.removeItem('mass_kempo_session');
    window.location.href = 'index.html';
});

// --- MANAJEMEN AKUN (MODAL & CRUD) ---
const modal = document.getElementById('accountModal');
document.getElementById('btnAccountSettings')?.addEventListener('click', () => {
    if (modal) modal.classList.add('active');
    loadUsers();
});
document.getElementById('btnCloseModal')?.addEventListener('click', () => {
    if (modal) modal.classList.remove('active');
});
if (modal) {
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
}

const viewList = document.getElementById('viewAccountList');
const viewForm = document.getElementById('viewAccountForm');
const form = document.getElementById('accountForm');
const tableBody = document.getElementById('accountTableBody');
const roleSelect = document.getElementById('accRole');
const courtGroup = document.getElementById('groupCourtId');

let isEditMode = false;

if (roleSelect && courtGroup) {
    roleSelect.addEventListener('change', (e) => {
        courtGroup.style.display = e.target.value === 'panitera' ? 'block' : 'none';
    });
}

document.getElementById('btnShowAddForm')?.addEventListener('click', () => {
    isEditMode = false;
    if (form) form.reset();
    const accUserInput = document.getElementById('accUsername');
    if (accUserInput) accUserInput.readOnly = false;
    if (courtGroup) courtGroup.style.display = 'block';
    if (viewList) viewList.style.display = 'none';
    if (viewForm) viewForm.style.display = 'block';
});

document.getElementById('btnCancelForm')?.addEventListener('click', () => {
    if (viewForm) viewForm.style.display = 'none';
    if (viewList) viewList.style.display = 'block';
});

async function loadUsers() {
    if (!tableBody || !db) return;
    tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Memuat data...</td></tr>';
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        tableBody.innerHTML = '';

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const username = docSnap.id;
            let namaUser = (data.nama && data.nama !== 'undefined') ? data.nama : '-';
            let courtTeks = (data.courtId && data.courtId !== 'undefined') ? `<br><small style="color:#64748b; font-weight:600;"><i class="fas fa-satellite-dish mr-1"></i> ${data.courtId}</small>` : '';

            let badgeClass = 'badge-role';
            let roleText = 'Seksi Acara';
            let iconHtml = '<i class="fas fa-calendar-alt"></i>';

            if (data.role === 'panitera') {
                badgeClass += ' badge-panitera'; roleText = 'Panitera'; iconHtml = '<i class="fas fa-balance-scale"></i>';
            } else if (data.role === 'seksi_pertandingan') {
                badgeClass += ' badge-admin'; roleText = 'Admin Utama'; iconHtml = '<i class="fas fa-user-shield"></i>';
            } else {
                badgeClass += ' badge-acara';
            }

            let actionButtons = `<div class="btn-action-group">
                <button class="btn-action btn-edit" onclick="window.editUser('${username}', '${namaUser}', '${data.role}', '${data.courtId || ''}', '${data.password}')" title="Edit"><i class="fas fa-edit"></i></button>`;

            if (username !== 'admin_utama' && username !== sessionStorage.getItem('username')) {
                actionButtons += `<button class="btn-action btn-delete" onclick="window.deleteUser('${username}')" title="Hapus"><i class="fas fa-trash"></i></button>`;
            }
            actionButtons += `</div>`;

            tableBody.innerHTML += `
                <tr>
                    <td><span style="font-family: monospace; font-size: 13px; font-weight: 700; color: #475569; background: #f1f5f9; padding: 4px 8px; border-radius: 4px;">${username}</span></td>
                    <td style="font-weight: 700;">${namaUser}${courtTeks}</td>
                    <td><span class="${badgeClass}">${iconHtml} ${roleText}</span></td>
                    <td>${actionButtons}</td>
                </tr>
            `;
        });
    } catch (error) {
        console.error("Gagal memuat user:", error);
        tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:red;">Gagal memuat data.</td></tr>';
    }
}

if (form) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('accUsername').value.trim();
        const btnSave = document.getElementById('btnSaveAccount');

        btnSave.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
        btnSave.disabled = true;

        const userData = {
            nama: document.getElementById('accNama').value.trim(),
            role: document.getElementById('accRole').value,
            password: document.getElementById('accPassword').value.trim()
        };

        if (userData.role === 'panitera') {
            userData.courtId = document.getElementById('accCourtId').value.trim();
        }

        try {
            await setDoc(doc(db, "users", username), userData);
            alert('Akun berhasil disimpan!');
            if (viewForm) viewForm.style.display = 'none';
            if (viewList) viewList.style.display = 'block';
            loadUsers();
        } catch (error) {
            console.error("Gagal menyimpan:", error);
            alert('Terjadi kesalahan saat menyimpan data.');
        } finally {
            btnSave.innerHTML = 'Simpan Akun';
            btnSave.disabled = false;
        }
    });
}

window.editUser = (username, nama, role, courtId, password) => {
    isEditMode = true;
    document.getElementById('accUsername').value = username;
    document.getElementById('accUsername').readOnly = true;
    document.getElementById('accNama').value = nama;
    document.getElementById('accRole').value = role;
    document.getElementById('accCourtId').value = courtId !== 'undefined' ? courtId : '';
    document.getElementById('accPassword').value = password;

    if (courtGroup) courtGroup.style.display = role === 'panitera' ? 'block' : 'none';
    if (viewList) viewList.style.display = 'none';
    if (viewForm) viewForm.style.display = 'block';
};

window.deleteUser = async (username) => {
    if (confirm(`PERINGATAN!\nApakah Anda yakin ingin MENGHAPUS akun '${username}'?`)) {
        try {
            await deleteDoc(doc(db, "users", username));
            alert('Akun berhasil dihapus.');
            loadUsers();
        } catch (error) {
            console.error("Gagal menghapus:", error);
            alert('Gagal menghapus akun.');
        }
    }
};
