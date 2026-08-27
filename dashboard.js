// dashboard.js
import { db } from './assets/js/firebase-app.js';
import { collection, getDocs, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// DOM Elements (Pop-up & Tab Bouncer bawaan)
document.addEventListener('DOMContentLoaded', () => {
    const isLoggedIn = sessionStorage.getItem('isLoggedIn');
    const role = sessionStorage.getItem('role');
    if (isLoggedIn !== 'true' || role !== 'seksi_pertandingan') {
        window.location.href = 'index.html';
    }
    // Tambahkan di dalam DOMContentLoaded dashboard.js:
fetch('/api/config')
    .then(res => res.json())
    .then(data => {
        const el = document.getElementById('liveEventInfo');
        if (el && data.eventName) {
            el.innerHTML = `<i class="fas fa-trophy text-primary"></i> <b>${data.eventName}</b> (${data.eventLocation || '-'})`;
        }
    })
    .catch(() => {});
});

document.getElementById('btnLogout').addEventListener('click', () => {
    sessionStorage.clear();
    window.location.href = 'index.html';
});

const modal = document.getElementById('accountModal');
document.getElementById('btnAccountSettings').addEventListener('click', () => {
    modal.classList.add('active');
    loadUsers(); // Muat data dari Firestore saat modal dibuka
});
document.getElementById('btnCloseModal').addEventListener('click', () => modal.classList.remove('active'));
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

// --- LOGIKA CRUD MANAJEMEN AKUN ---
const viewList = document.getElementById('viewAccountList');
const viewForm = document.getElementById('viewAccountForm');
const form = document.getElementById('accountForm');
const tableBody = document.getElementById('accountTableBody');
const roleSelect = document.getElementById('accRole');
const courtGroup = document.getElementById('groupCourtId');

let isEditMode = false;

// Tampilkan/Sembunyikan Input Court ID secara pintar
roleSelect.addEventListener('change', (e) => {
    if (e.target.value === 'panitera') courtGroup.style.display = 'block';
    else courtGroup.style.display = 'none';
});

document.getElementById('btnShowAddForm').addEventListener('click', () => {
    isEditMode = false;
    form.reset();
    document.getElementById('accUsername').readOnly = false; // Bisa diketik
    courtGroup.style.display = 'block';
    viewList.style.display = 'none';
    viewForm.style.display = 'block';
});

document.getElementById('btnCancelForm').addEventListener('click', () => {
    viewForm.style.display = 'none';
    viewList.style.display = 'block';
});

// 1. READ: Ambil Data dari Firestore
async function loadUsers() {
    tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Memuat data...</td></tr>';
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        tableBody.innerHTML = '';

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const username = docSnap.id;

            // Pembersih teks undefined
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

            // Desain tombol aksi Group
            let actionButtons = `<div class="btn-action-group">
                <button class="btn-action btn-edit" onclick="window.editUser('${username}', '${namaUser}', '${data.role}', '${data.courtId || ''}', '${data.password}')" title="Ubah Sandi / Edit"><i class="fas fa-edit"></i></button>`;

            if (username !== 'admin_utama' && username !== sessionStorage.getItem('username')) {
                actionButtons += `<button class="btn-action btn-delete" onclick="window.deleteUser('${username}')" title="Hapus Permanen"><i class="fas fa-trash"></i></button>`;
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

// 2. CREATE / UPDATE: Simpan ke Firestore
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
        viewForm.style.display = 'none';
        viewList.style.display = 'block';
        loadUsers();
    } catch (error) {
        console.error("Gagal menyimpan:", error);
        alert('Terjadi kesalahan saat menyimpan data.');
    } finally {
        btnSave.innerHTML = 'Simpan Akun';
        btnSave.disabled = false;
    }
});

// Menjadikan fungsi tersedia secara global agar bisa dipanggil dari atribut onclick di HTML tabel
window.editUser = (username, nama, role, courtId, password) => {
    isEditMode = true;
    document.getElementById('accUsername').value = username;
    document.getElementById('accUsername').readOnly = true; // Kunci ID agar tidak terduplikasi

    document.getElementById('accNama').value = nama;
    document.getElementById('accRole').value = role;
    document.getElementById('accCourtId').value = courtId !== 'undefined' ? courtId : '';
    document.getElementById('accPassword').value = password;

    courtGroup.style.display = role === 'panitera' ? 'block' : 'none';

    viewList.style.display = 'none';
    viewForm.style.display = 'block';
};

window.deleteUser = async (username) => {
    if (confirm(`PERINGATAN!\nApakah Anda yakin ingin MENGHAPUS permanen akun '${username}'?`)) {
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