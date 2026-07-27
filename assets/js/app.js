(() => {
    'use strict';

    const app = document.getElementById('app');
    const toastStack = document.getElementById('toast-stack');
    const config = window.APICULTURA_CONFIG || {};
    const STORAGE = {
        apiUrl: 'apicultura_api_url',
        token: 'apicultura_api_token',
        user: 'apicultura_api_user'
    };

    const state = {
        apiUrl: localStorage.getItem(STORAGE.apiUrl) || config.apiUrl || '',
        token: localStorage.getItem(STORAGE.token) || '',
        user: JSON.parse(localStorage.getItem(STORAGE.user) || 'null'),
        protectedUrls: []
    };

    const h = value => String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

    const nl2br = value => h(value).replace(/\r?\n/g, '<br>');
    const today = () => new Date().toISOString().slice(0, 10);
    const currentMonth = () => new Date().toISOString().slice(0, 7);
    const moneyARS = value => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(value) || 0);
    const moneyUSD = value => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
    const number3 = value => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(value) || 0);
    const formatDate = value => {
        if (!value) return '—';
        const parts = String(value).slice(0, 10).split('-');
        return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
    };
    const formatDateTime = value => {
        if (!value) return '—';
        const date = new Date(String(value).replace(' ', 'T'));
        return Number.isNaN(date.getTime()) ? h(value) : new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
    };
    const monthLabel = value => {
        if (!value) return '';
        const date = new Date(`${String(value).slice(0, 7)}-02T12:00:00`);
        const text = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(date);
        return text.charAt(0).toUpperCase() + text.slice(1);
    };
    const capitalize = value => {
        const text = String(value ?? '').replaceAll('_', ' ');
        return text.charAt(0).toUpperCase() + text.slice(1);
    };

    function normalizeApiUrl(value) {
        let url = String(value || '').trim().replace(/\/+$/, '');
        if (!url) return '';
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        if (/\/index\.php$/i.test(url)) return url;
        if (/\/api$/i.test(url)) return `${url}/index.php`;
        if (/\/apicultura$/i.test(url)) return `${url}/api/index.php`;
        return `${url}/apicultura/api/index.php`;
    }

    function saveApiUrl(value) {
        state.apiUrl = normalizeApiUrl(value);
        localStorage.setItem(STORAGE.apiUrl, state.apiUrl);
    }

    function saveSession(token, user) {
        state.token = token;
        state.user = user;
        localStorage.setItem(STORAGE.token, token);
        localStorage.setItem(STORAGE.user, JSON.stringify(user));
    }

    function clearSession() {
        state.token = '';
        state.user = null;
        localStorage.removeItem(STORAGE.token);
        localStorage.removeItem(STORAGE.user);
    }

    function revokeProtectedUrls() {
        state.protectedUrls.forEach(url => URL.revokeObjectURL(url));
        state.protectedUrls = [];
    }

    function toast(message, type = 'success') {
        const element = document.createElement('div');
        element.className = `toast-message ${type}`;
        element.setAttribute('role', 'status');
        element.textContent = message;
        toastStack.appendChild(element);
        requestAnimationFrame(() => element.classList.add('is-visible'));
        setTimeout(() => {
            element.classList.add('is-leaving');
            setTimeout(() => element.remove(), 240);
        }, 4050);
    }

    async function api(action, options = {}) {
        if (!state.apiUrl) throw new Error('Primero configure la dirección del servidor.');
        const method = options.method || 'GET';
        const url = new URL(state.apiUrl);
        url.searchParams.set('action', action);
        Object.entries(options.params || {}).forEach(([key, value]) => {
            if (value !== '' && value !== null && value !== undefined && value !== 0) url.searchParams.set(key, value);
        });
        const headers = { ...(options.headers || {}) };
        if (state.token && !options.noAuth) headers.Authorization = `Bearer ${state.token}`;
        const fetchOptions = { method, headers, cache: 'no-store' };
        if (options.formData) {
            fetchOptions.body = options.formData;
        } else if (options.data !== undefined) {
            headers['Content-Type'] = 'application/json';
            fetchOptions.body = JSON.stringify(options.data);
        }
        let response;
        try {
            response = await fetch(url.toString(), fetchOptions);
        } catch (error) {
            throw new Error('No se pudo conectar con la computadora donde funciona Laragon.');
        }
        if (options.blob) {
            if (!response.ok) {
                let message = 'No se pudo descargar el archivo.';
                try { message = (await response.json()).message || message; } catch (_) {}
                if (response.status === 401) sessionExpired();
                throw new Error(message);
            }
            return response.blob();
        }
        let payload;
        try {
            payload = await response.json();
        } catch (_) {
            throw new Error(`El servidor respondió con un formato inválido (${response.status}).`);
        }
        if (!response.ok || !payload.ok) {
            if (response.status === 401) sessionExpired();
            throw new Error(payload.message || 'No se pudo completar la operación.');
        }
        return payload;
    }

    function sessionExpired() {
        clearSession();
        setTimeout(() => {
            renderLogin('La sesión venció. Vuelva a ingresar.');
        }, 0);
    }

    function loading(text = 'Cargando…') {
        revokeProtectedUrls();
        app.className = 'app-loading';
        app.innerHTML = `<div><div class="auth-bee">🐝</div><strong>${h(text)}</strong></div>`;
    }

    function parseHash() {
        const raw = (location.hash || '#/dashboard').slice(1);
        const [pathPart, queryPart = ''] = raw.split('?');
        const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
        return { path, params: new URLSearchParams(queryPart) };
    }

    function go(path, params = {}) {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== '' && value !== null && value !== undefined && value !== 0) query.set(key, value);
        });
        const nextHash = `#${path}${query.toString() ? `?${query}` : ''}`;
        if (location.hash === nextHash) {
            route();
        } else {
            location.hash = nextHash;
        }
    }

    function availableApps(user = state.user) {
        const apps = Array.isArray(user?.apps) ? user.apps : [user?.app_code || 'apicultura'];
        return [...new Set(apps.filter(Boolean))];
    }

    function canAccessApp(code) {
        return availableApps().includes(code);
    }

    function appSwitcher(current) {
        const apps = availableApps();
        const currentLabel = current === 'ganaderia' ? 'Gestión Ganadera' : 'Gestión Apícola';
        const currentIcon = current === 'ganaderia' ? '⌾' : '🐝';
        if (apps.length < 2) {
            return `<a class="brand" href="${current === 'ganaderia' ? 'ganaderia.html#/ganaderia' : '#/dashboard'}"><span class="brand-icon ${current === 'ganaderia' ? 'livestock-brand-icon' : ''}">${currentIcon}</span><span><strong>${currentLabel}</strong><small>Acceso privado</small></span></a>`;
        }
        return `<div class="app-switcher"><button class="brand app-switcher-trigger" type="button" data-command="app-switch-toggle" aria-expanded="false"><span class="brand-icon ${current === 'ganaderia' ? 'livestock-brand-icon' : ''}">${currentIcon}</span><span><strong>${currentLabel}</strong><small>Cambiar de vista</small></span><span class="app-switch-chevron">⌄</span></button><div class="app-switch-menu" hidden>${apps.includes('apicultura') ? `<button type="button" data-command="switch-app" data-app="apicultura" class="${current === 'apicultura' ? 'active' : ''}"><span>🐝</span><div><strong>Gestión Apícola</strong><small>Colmenas y apiario</small></div></button>` : ''}${apps.includes('ganaderia') ? `<button type="button" data-command="switch-app" data-app="ganaderia" class="${current === 'ganaderia' ? 'active' : ''}"><span>⌾</span><div><strong>Gestión Ganadera</strong><small>Animales y parcelas</small></div></button>` : ''}</div></div>`;
    }

    const navItems = [
        ['/dashboard', '⌂', 'Inicio', 'dashboard'],
        ['/hives', '▦', 'Colmenas', 'hives'],
        ['/activities', '✓', 'Actividades', 'activities'],
        ['/materials', '⬡', 'Materiales', 'materials'],
        ['/purchases', '▤', 'Compras pendientes', 'purchases'],
        ['/accounting', '$', 'Contabilidad', 'accounting'],
        ['/backups', '⇩', 'Copias de seguridad', 'backups']
    ];

    function shell({ title, subtitle = '', active = 'dashboard', actions = '', content }) {
        revokeProtectedUrls();
        const user = state.user || { display_name: 'Usuario' };
        const initial = h(String(user.display_name || 'U').slice(0, 1).toUpperCase());
        document.title = `${title} · Gestión Apícola`;
        document.body.className = '';
        app.className = '';
        app.innerHTML = `
            <div class="app-shell">
                <aside class="sidebar" id="sidebar">
                    ${appSwitcher('apicultura')}
                    <nav class="nav-menu">
                        ${navItems.map(([path, icon, label, key]) => `<a class="${active === key ? 'active' : ''}" href="#${path}"><span>${icon}</span> ${label}</a>`).join('')}
                    </nav>
                    <div class="sidebar-user">
                        <div class="sidebar-avatar">${initial}</div>
                        <div><strong>${h(user.display_name)}</strong><a href="#/profile">Mi cuenta</a></div>
                    </div>
                    <div class="sidebar-footer">Base y archivos guardados en la computadora servidor.</div>
                </aside>
                <div class="main-area">
                    <header class="topbar">
                        <button class="menu-button" type="button" data-toggle-sidebar aria-label="Abrir menú">☰</button>
                        <div class="topbar-heading"><h1>${h(title)}</h1>${subtitle ? `<p>${h(subtitle)}</p>` : ''}</div>
                        <div class="topbar-actions">${actions}</div>
                        <div class="topbar-user-menu">
                            <a class="user-chip" href="#/profile"><span>${initial}</span>${h(user.display_name)}</a>
                            <button class="btn btn-ghost btn-small" type="button" data-command="logout">Salir</button>
                        </div>
                    </header>
                    <main class="content">${content}</main>
                </div>
            </div>`;
        initCommonUi();
    }

    function initCommonUi() {
        const sidebar = document.getElementById('sidebar');
        document.querySelector('[data-toggle-sidebar]')?.addEventListener('click', () => sidebar?.classList.toggle('open'));
        initPolishEffects();
    }

    function revealQueenHistory(scroll = false) {
        const panel = document.querySelector('[data-queen-history]');
        if (!panel) return;
        panel.hidden = false;
        document.querySelectorAll('[data-command="queen-history-toggle"]').forEach(button => button.setAttribute('aria-expanded', 'true'));
        if (scroll) setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'center' }), 30);
    }

    function initPolishEffects() {
        document.querySelector('.content')?.classList.add('page-enter');
        document.querySelectorAll('.btn, .icon-button, .dashboard-card, .entity-card, .kanban-card').forEach(element => {
            if (element.dataset.rippleReady) return;
            element.dataset.rippleReady = '1';
            element.addEventListener('pointerdown', event => {
                if (element.matches(':disabled')) return;
                const rect = element.getBoundingClientRect();
                const ripple = document.createElement('span');
                ripple.className = 'ui-ripple';
                const size = Math.max(rect.width, rect.height) * 1.35;
                ripple.style.width = ripple.style.height = `${size}px`;
                ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
                ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
                element.appendChild(ripple);
                setTimeout(() => ripple.remove(), 620);
            });
        });
    }

    function renderLogin(message = '') {
        revokeProtectedUrls();
        document.title = 'Ingresar · Mellifera Technology';
        document.body.className = 'auth-page';
        app.className = '';
        const apiDisplay = state.apiUrl || 'Todavía no configurado';
        app.innerHTML = `
            <main class="auth-card">
                <div class="auth-brand">
                    <div class="auth-bee">🌾</div>
                    <div><h1>Mellifera Technology</h1><p>Ingreso privado a sistemas de gestión</p></div>
                </div>
                ${message ? `<div class="alert alert-danger">${h(message)}</div>` : ''}
                <form class="auth-form" data-form="login" autocomplete="on">
                    <label class="field"><span>Usuario</span><input type="text" name="username" maxlength="80" required autofocus autocomplete="username" placeholder="Usuario"></label>
                    <label class="field"><span>Contraseña</span><div class="password-input-wrap"><input id="login-password" type="password" name="password" required autocomplete="current-password"><button type="button" class="password-toggle" data-password-toggle="login-password">Ver</button></div></label>
                    <button class="btn btn-primary btn-block btn-large" type="submit">Ingresar</button>
                </form>
                <div class="auth-security">🔒 Los datos permanecen en la base MariaDB del servidor.</div>
                <details class="server-config" ${state.apiUrl ? '' : 'open'}>
                    <summary>Configurar conexión con Laragon</summary>
                    <form class="server-config-form" data-form="server-config">
                        <label class="field"><span>Dirección pública del servidor</span><input type="url" name="api_url" required value="${h(state.apiUrl)}" placeholder="https://direccion.trycloudflare.com"></label>
                        <button class="btn btn-secondary" type="submit">Guardar y comprobar</button>
                    </form>
                    <div class="connection-state"><span class="connection-dot ${state.apiUrl ? '' : 'offline'}"></span><span>${h(apiDisplay)}</span></div>
                </details>
            </main>`;
        initPasswordToggles();
    }

    function initPasswordToggles() {
        document.querySelectorAll('[data-password-toggle]').forEach(button => {
            button.addEventListener('click', () => {
                const input = document.getElementById(button.dataset.passwordToggle || '');
                if (!input) return;
                const showing = input.type === 'text';
                input.type = showing ? 'password' : 'text';
                button.textContent = showing ? 'Ver' : 'Ocultar';
            });
        });
    }

    function emptyState(icon, title, text, action = '') {
        return `<div class="empty-state"><div>${icon}</div><h3>${h(title)}</h3><p>${h(text)}</p>${action}</div>`;
    }

    async function renderDashboard() {
        loading('Cargando el resumen…');
        const data = await api('dashboard');
        const materials = data.stats.materials || {};
        const purchases = data.stats.purchase_plans || {};
        const accounting = data.stats.accounting || {};
        const banner = data.banner || {};
        shell({
            title: 'Inicio', subtitle: 'Resumen general del proyecto apícola', active: 'dashboard',
            actions: '<a class="btn btn-primary" href="#/activity-edit">+ Nueva actividad</a>',
            content: `
                <section class="apiculture-hero-banner panel ${Number(banner.has_file) ? 'has-photo' : ''}">
                    ${Number(banner.has_file) ? `<img class="protected-image" data-protected-image="1" data-file-type="apiculture_banner" data-id="1" alt="${h(banner.caption || 'Vista general del apiario')}">` : '<div class="apiculture-hero-placeholder"><span>✦</span><strong>Su apiario, en una sola mirada</strong><small>Agregue una fotografía para personalizar el inicio.</small></div>'}
                    <div class="apiculture-hero-overlay">
                        <div><span class="eyebrow">GESTIÓN APÍCOLA</span><h2>${h(banner.caption || 'Vista general del apiario')}</h2><p>Un espacio visual para reconocer el proyecto apenas ingresa.</p></div>
                        <button class="banner-edit-pencil" type="button" data-command="banner-editor-toggle" aria-label="Modificar imagen del inicio" title="Modificar imagen">✎</button>
                        <form class="hero-upload-form banner-editor-popover" data-banner-editor hidden data-form="apiculture-banner-upload" enctype="multipart/form-data">
                            <div class="banner-editor-title"><strong>Imagen del inicio</strong><button type="button" class="icon-button" data-command="banner-editor-toggle">×</button></div>
                            <input type="file" name="banner" accept="image/jpeg,image/png,image/webp" required>
                            <input type="text" name="caption" maxlength="255" value="${h(banner.caption || '')}" placeholder="Título opcional">
                            <button class="btn btn-primary" type="submit">${Number(banner.has_file) ? 'Guardar cambio' : 'Agregar imagen'}</button>
                            ${Number(banner.has_file) ? '<button class="btn btn-ghost" type="button" data-command="apiculture-banner-delete">Quitar imagen</button>' : ''}
                        </form>
                    </div>
                </section>
                <section class="balance-strip">
                    <div class="balance-strip-title"><span>Saldo por persona</span><small>Ingresos menos egresos, desde el comienzo del proyecto</small></div>
                    ${(data.balances || []).map(balance => `<div class="person-balance ${Number(balance.balance_ars) < 0 ? 'negative' : 'positive'}"><strong>${h(balance.name)}</strong><span>${moneyUSD(balance.balance_usd)}</span><small>${moneyARS(balance.balance_ars)}</small></div>`).join('')}
                </section>
                <section class="dashboard-grid">
                    <a class="dashboard-card card-hives" href="#/hives"><div class="dashboard-card-icon">▦</div><div><span>Colmenas</span><strong>${Number(data.stats.hives || 0)}</strong><small>Fichas e historial</small></div></a>
                    <a class="dashboard-card card-activities" href="#/activities"><div class="dashboard-card-icon">✓</div><div><span>Actividades pendientes</span><strong>${Number(data.stats.pending_activities || 0)}</strong><small>Para hacer o en proceso</small></div></a>
                    <a class="dashboard-card card-materials" href="#/materials"><div class="dashboard-card-icon">⬡</div><div><span>Materiales</span><strong>${Number(materials.total || 0)}</strong><small>${Number(materials.available || 0)} disponibles · ${Number(materials.in_use || 0)} en uso · ${Number(materials.repair || 0)} en reparación</small></div></a>
                    <a class="dashboard-card card-purchases" href="#/purchases"><div class="dashboard-card-icon">▤</div><div><span>Compras pendientes</span><strong>${Number(purchases.total || 0)}</strong><small>Total planificado: ${moneyARS(purchases.amount)}</small></div></a>
                    <a class="dashboard-card card-accounting" href="#/accounting"><div class="dashboard-card-icon">$</div><div><span>Contabilidad</span><strong>${Number(accounting.total || 0)}</strong><small>Balance histórico: ${moneyUSD(accounting.balance_usd)} · ${moneyARS(accounting.balance)}</small></div></a>
                </section>
                <section class="panel animated-panel">
                    <div class="panel-header"><div><h2>Próximas actividades</h2><p>Las más urgentes o próximas a vencer</p></div><a class="btn btn-secondary" href="#/activities">Abrir tablero</a></div>
                    ${(data.recent_activities || []).length ? `<div class="compact-list">${data.recent_activities.map(activity => `<a href="#/activity-edit/${activity.id}" class="compact-item"><span class="status-dot" style="--dot-color:${h(activity.status_color)}"></span><div><strong>${h(activity.title)}</strong><small>${h(activity.hive_name || 'Sin colmena')}</small>${activity.label_name ? `<span class="activity-label compact-label" style="--label-color:${h(activity.label_color || '#64748b')}">${h(activity.label_name)}</span>` : ''}</div><span class="priority priority-${h(activity.priority)}">${capitalize(activity.priority)}</span><time>${formatDate(activity.due_date)}</time></a>`).join('')}</div>` : emptyState('✓', 'No hay actividades abiertas', 'Puede crear la primera desde el botón superior.')}
                </section>`
        });
        hydrateProtectedImages();
    }

    async function renderHives(params) {
        loading('Cargando colmenas…');
        const q = params.get('q') || '';
        const status = params.get('status') || '';
        const data = await api('hives', { params: { q, status } });
        shell({
            title: 'Colmenas', subtitle: 'Estado, reina, observaciones, actividades, historial y fotografías', active: 'hives',
            actions: '<a class="btn btn-primary" href="#/hive-edit">+ Nueva colmena</a>',
            content: `
                <form class="filter-bar" data-form="hive-filter">
                    <label class="search-field"><span>⌕</span><input type="search" name="q" value="${h(q)}" placeholder="Buscar colmena"></label>
                    <select name="status"><option value="">Todos los estados</option><option value="activa" ${status === 'activa' ? 'selected' : ''}>Activa</option><option value="observacion" ${status === 'observacion' ? 'selected' : ''}>En observación</option><option value="inactiva" ${status === 'inactiva' ? 'selected' : ''}>Inactiva</option><option value="baja" ${status === 'baja' ? 'selected' : ''}>Baja</option></select>
                    <button class="btn btn-secondary" type="submit">Filtrar</button><a class="btn btn-ghost" href="#/hives">Limpiar</a>
                </form>
                ${(data.hives || []).length ? `<section class="card-grid">${data.hives.map(hive => `<article class="entity-card hive-visual-card">
                    <div class="hive-card-cover ${hive.cover_photo_id ? 'has-photo' : ''}">
                        ${hive.cover_photo_id ? `<img class="protected-image" data-protected-image="1" data-file-type="hive" data-id="${hive.cover_photo_id}" alt="${h(hive.name)}">` : '<div class="hive-card-placeholder"><span>⬡</span><small>Sin banner</small></div>'}
                        <span class="badge status-${h(hive.status)}">${capitalize(hive.status)}</span>
                    </div>
                    <div class="hive-card-body"><h2>${h(hive.name)}</h2><div class="entity-meta"><span><b>Creada:</b> ${formatDate(hive.creation_date)}</span><span><b>Reina:</b> ${hive.queen_year ? h(hive.queen_year) : 'Sin indicar'}</span></div><div class="entity-counters"><span><strong>${Number(hive.open_activities || 0)}</strong> actividades</span><span><strong>${Number(hive.notes_count || 0)}</strong> observaciones</span><span><strong>${Number(hive.photos_count || 0)}</strong> archivos</span></div><div class="entity-actions"><a class="btn btn-primary" href="#/hive/${hive.id}">Abrir ficha</a><a class="btn btn-ghost" href="#/hive-edit/${hive.id}">Editar</a></div></div>
                </article>`).join('')}</section>` : `<div class="empty-state panel"><div>▦</div><h3>No hay colmenas</h3><p>Cree la primera ficha para comenzar.</p><a class="btn btn-primary" href="#/hive-edit">Crear colmena</a></div>`}`
        });
        hydrateProtectedImages();
    }

    async function renderHive(id) {
        loading('Abriendo la ficha…');
        const data = await api('hive', { params: { id } });
        const hive = data.hive;
        const photos = data.photos || [];
        const queens = data.queens || [];
        const cover = photos.find(photo => Number(photo.is_cover));
        const openActivities = (data.activities || []).filter(item => !Number(item.is_closed));
        const historyActivities = (data.activities || []).filter(item => Number(item.is_closed));
        shell({
            title: hive.name, subtitle: 'Ficha completa de la colmena', active: 'hives',
            actions: `<a class="btn btn-secondary" href="#/hive-edit/${hive.id}">Editar</a><a class="btn btn-ghost" href="#/hives">Volver</a>`,
            content: `
                <section class="hive-profile-hero panel ${cover ? 'has-photo' : ''}">
                    ${cover ? `<img class="protected-image" data-protected-image="1" data-file-type="hive" data-id="${cover.id}" alt="Banner de ${h(hive.name)}">` : '<div class="hive-profile-placeholder">⬡</div>'}
                    <div class="hive-profile-shade"></div>
                    <div class="hive-profile-content"><div class="hive-summary-main"><span class="badge status-${h(hive.status)}">${capitalize(hive.status)}</span><h2>${h(hive.name)}</h2><p>Creada el ${formatDate(hive.creation_date)}</p></div>
                        <button class="hive-summary-stat queen-stat-button" type="button" data-command="queen-history-toggle" aria-expanded="false"><small>Año de la reina</small><strong>${hive.queen_year || '—'}</strong><span>Ver historial</span></button>
                        <div class="hive-summary-stat"><small>Actividades abiertas</small><strong>${openActivities.length}</strong></div>
                        <div class="hive-summary-stat"><small>Materiales en uso</small><strong>${(data.materials || []).length}</strong></div>
                    </div>
                </section>
                <section class="panel queen-history-panel" data-queen-history hidden>
                    <div class="panel-header"><div><span class="eyebrow">TRAZABILIDAD</span><h2>Historial de reinas</h2><p>Cada cambio queda registrado sin perder las reinas anteriores.</p></div><button class="icon-button" type="button" data-command="queen-history-toggle" aria-label="Cerrar">×</button></div>
                    <form class="queen-entry-form" data-form="hive-queen-save"><input type="hidden" name="hive_id" value="${hive.id}"><label class="field"><span>Fecha del cambio</span><input type="date" name="change_date" value="${today()}" required></label><label class="field"><span>Año de la nueva reina</span><input type="number" name="queen_year" min="1990" max="${new Date().getFullYear()+1}" value="${new Date().getFullYear()}" required></label><label class="field queen-notes"><span>Observaciones</span><input type="text" name="notes" maxlength="500" placeholder="Origen, color, genética o detalle opcional"></label><button class="btn btn-primary" type="submit">+ Agregar reina</button></form>
                    ${queens.length ? `<div class="queen-timeline">${queens.map((queen,index) => `<article class="queen-history-item ${index===0?'current':''}"><div class="queen-year-medal">${h(queen.queen_year)}</div><div><strong>${index===0?'Reina actual':'Reina anterior'}</strong><span>Cambio registrado el ${formatDate(queen.change_date)}</span>${queen.notes ? `<p>${h(queen.notes)}</p>` : ''}<small>Cargado ${formatDateTime(queen.created_at)}</small></div><button class="icon-button danger" type="button" data-command="hive-queen-delete" data-id="${queen.id}" data-hive-id="${hive.id}" title="Eliminar registro">×</button></article>`).join('')}</div>` : '<p class="muted empty-line">Todavía no hay reinas registradas.</p>'}
                </section>
                <div class="detail-grid">
                    <section class="panel span-2 animated-panel"><div class="panel-header"><div><h2>Observaciones</h2><p>Puede agregar todas las que necesite</p></div></div>
                        <form class="inline-entry-form" data-form="hive-note-save"><input type="hidden" name="hive_id" value="${hive.id}"><input type="date" name="note_date" value="${today()}" required><textarea name="note" rows="2" required placeholder="Escriba una observación nueva"></textarea><button class="btn btn-primary" type="submit">+ Agregar</button></form>
                        ${(data.notes || []).length ? `<div class="timeline">${data.notes.map(note => `<div class="timeline-item"><div class="timeline-date">${formatDate(note.note_date)}</div><div class="timeline-content"><p>${nl2br(note.note)}</p><small>Cargada ${formatDateTime(note.created_at)}</small></div><button class="icon-button danger" data-command="hive-note-delete" data-id="${note.id}" data-hive-id="${hive.id}" title="Eliminar">×</button></div>`).join('')}</div>` : '<p class="muted empty-line">Todavía no hay observaciones.</p>'}
                    </section>
                    <section class="panel animated-panel"><div class="panel-header"><div><h2>Materiales en uso</h2><p>Asignados a esta colmena</p></div><a class="btn btn-small btn-secondary" href="#/materials">Administrar</a></div>${(data.materials || []).length ? `<div class="simple-list">${data.materials.map(material => `<div><span>⬡</span><strong>${h(material.name)}</strong></div>`).join('')}</div>` : '<p class="muted empty-line">No tiene materiales asignados.</p>'}</section>
                    <section class="panel span-2 animated-panel"><div class="panel-header"><div><h2>Actividades abiertas</h2><p>Trabajo pendiente en esta colmena</p></div><a class="btn btn-small btn-primary" href="#/activity-edit?hive_id=${hive.id}">+ Actividad</a></div>${openActivities.length ? `<div class="compact-list">${openActivities.map(activity => `<a class="compact-item" href="#/activity-edit/${activity.id}"><span class="status-dot" style="--dot-color:${h(activity.status_color)}"></span><div><strong>${h(activity.title)}</strong><small>${h(activity.status_name)}</small>${activity.label_name ? `<span class="activity-label compact-label" style="--label-color:${h(activity.label_color || '#64748b')}">${h(activity.label_name)}</span>` : ''}</div><span class="priority priority-${h(activity.priority)}">${capitalize(activity.priority)}</span><time>${formatDate(activity.due_date)}</time></a>`).join('')}</div>` : '<p class="muted empty-line">No hay actividades abiertas.</p>'}</section>
                    <section class="panel animated-panel"><div class="panel-header"><div><h2>Historial</h2><p>Actividades terminadas</p></div></div>${historyActivities.length ? `<div class="history-list">${historyActivities.map(activity => `<a href="#/activity-edit/${activity.id}"><strong>${h(activity.title)}</strong><small>${formatDateTime(activity.completed_at)}</small></a>`).join('')}</div>` : '<p class="muted empty-line">Todavía no hay actividades terminadas.</p>'}</section>
                    <section class="panel span-3 animated-panel"><div class="panel-header"><div><h2>Fotografías y archivos</h2><p>Seleccione una fotografía como banner de la colmena</p></div></div>
                        <form class="upload-form" data-form="hive-photo-upload" enctype="multipart/form-data"><input type="hidden" name="hive_id" value="${hive.id}"><input type="file" name="photo" accept="image/jpeg,image/png,image/webp,application/pdf" required><input type="text" name="caption" placeholder="Descripción opcional"><button class="btn btn-primary" type="submit">Subir archivo</button></form>
                        ${photos.length ? `<div class="media-grid">${photos.map(photo => `<article class="media-card ${Number(photo.is_cover)?'is-cover':''}">${Number(photo.is_cover)?'<span class="cover-ribbon">Banner actual</span>':''}<button class="file-button" data-command="open-file" data-file-type="hive" data-id="${photo.id}" data-name="${h(photo.original_name)}">${String(photo.mime_type).startsWith('image/') ? `<img class="protected-image" data-protected-image="1" data-file-type="hive" data-id="${photo.id}" alt="${h(photo.caption || photo.original_name)}">` : '<div class="pdf-preview">PDF</div>'}<strong>${h(photo.caption || photo.original_name)}</strong><small>${formatDateTime(photo.uploaded_at)}</small></button><div class="media-card-actions">${String(photo.mime_type).startsWith('image/') && !Number(photo.is_cover) ? `<button class="btn btn-small btn-secondary" type="button" data-command="hive-photo-cover" data-id="${photo.id}" data-hive-id="${hive.id}">Usar como banner</button>` : ''}<button class="icon-button danger" type="button" data-command="hive-photo-delete" data-id="${photo.id}" data-hive-id="${hive.id}" title="Eliminar">×</button></div></article>`).join('')}</div>` : '<p class="muted empty-line">Todavía no hay fotografías ni documentos.</p>'}
                    </section>
                </div>`
        });
        hydrateProtectedImages();
    }

    async function renderHiveEdit(id = 0) {
        loading('Preparando la ficha…');
        const data = id ? await api('hive', { params: { id } }) : { hive: null };
        const hive = data.hive;
        shell({
            title: hive ? 'Editar colmena' : 'Nueva colmena', subtitle: hive ? hive.name : 'Cree una ficha simple y clara', active: 'hives',
            actions: `<a class="btn btn-ghost" href="${hive ? `#/hive/${hive.id}` : '#/hives'}">Volver</a>`,
            content: `<section class="form-card narrow"><form data-form="hive-save"><input type="hidden" name="id" value="${hive?.id || ''}"><div class="form-grid two-columns"><label class="field full"><span>Nombre *</span><input type="text" name="name" required maxlength="120" value="${h(hive?.name || '')}" placeholder="Ej.: Colmena 1"></label><label class="field"><span>Estado</span><select name="status">${[['activa','Activa'],['observacion','En observación'],['inactiva','Inactiva'],['baja','Baja']].map(([value,label]) => `<option value="${value}" ${(hive?.status || 'activa') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field"><span>Fecha de creación</span><input type="date" name="creation_date" required value="${h(hive?.creation_date || today())}"></label>${hive ? `<div class="field queen-edit-hint"><span>Reina actual</span><a href="#/hive/${hive.id}" class="queen-edit-link"><strong>${hive.queen_year || 'Sin registrar'}</strong><small>Abra la ficha para ver o agregar cambios de reina →</small></a></div>` : `<label class="field"><span>Año de la reina inicial</span><input type="number" name="queen_year" min="1990" max="${new Date().getFullYear() + 1}" value="" placeholder="Ej.: ${new Date().getFullYear()}"></label>`}</div><div class="form-actions"><button class="btn btn-primary" type="submit">Guardar colmena</button><a class="btn btn-ghost" href="${hive ? `#/hive/${hive.id}` : '#/hives'}">Cancelar</a></div></form>${hive ? `<hr><button class="btn btn-danger" data-command="hive-delete" data-id="${hive.id}">Eliminar colmena</button>` : ''}</section>`
        });
    }

    async function renderMaterials(params) {
        loading('Cargando materiales…');
        const status = params.get('status') || '';
        const q = params.get('q') || '';
        const edit = Number(params.get('edit') || 0);
        const data = await api('materials', { params: { status, q } });
        const editing = edit ? (data.materials || []).find(item => Number(item.id) === edit) || (await api('materials')).materials.find(item => Number(item.id) === edit) : null;
        const counts = data.counts || {};
        const pill = (value, label, count) => `<a class="summary-pill ${status === value ? 'active' : ''}" href="#/materials${value ? `?status=${value}` : ''}"><strong>${Number(count || 0)}</strong><span>${label}</span></a>`;
        shell({
            title: 'Materiales', subtitle: 'Disponibles, en uso o en reparación', active: 'materials',
            content: `<section class="summary-pills">${pill('', 'Todos', counts.total)}${pill('disponible', 'Disponibles', counts.available)}${pill('en_uso', 'En uso', counts.in_use)}${pill('reparacion', 'En reparación', counts.repair)}</section>
                <div class="split-layout"><section class="panel sticky-panel"><div class="panel-header"><div><h2>${editing ? 'Editar material' : 'Agregar material'}</h2><p>Un registro por elemento</p></div></div><form data-form="material-save" data-material-form><input type="hidden" name="id" value="${editing?.id || ''}"><label class="field"><span>Nombre *</span><input type="text" name="name" required maxlength="160" value="${h(editing?.name || '')}" placeholder="Ej.: Alza mediana"></label><label class="field"><span>Estado</span><select name="status" data-material-status>${[['disponible','Disponible'],['en_uso','En uso'],['reparacion','En reparación']].map(([value,label]) => `<option value="${value}" ${(editing?.status || 'disponible') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field" data-hive-field><span>Colmena</span><select name="hive_id"><option value="">Seleccione</option>${(data.hives || []).map(hive => `<option value="${hive.id}" ${Number(editing?.hive_id || 0) === Number(hive.id) ? 'selected' : ''}>${h(hive.name)}</option>`).join('')}</select></label><label class="field"><span>Notas</span><textarea name="notes" rows="3" placeholder="Detalle opcional">${h(editing?.notes || '')}</textarea></label><div class="form-actions"><button class="btn btn-primary" type="submit">${editing ? 'Guardar cambios' : '+ Agregar material'}</button>${editing ? '<a class="btn btn-ghost" href="#/materials">Cancelar</a>' : ''}</div></form></section>
                <section class="panel"><form class="filter-bar compact" data-form="material-filter"><input type="hidden" name="status" value="${h(status)}"><label class="search-field"><span>⌕</span><input type="search" name="q" value="${h(q)}" placeholder="Buscar material o colmena"></label><button class="btn btn-secondary" type="submit">Buscar</button></form>${(data.materials || []).length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Material</th><th>Estado</th><th>Colmena</th><th>Notas</th><th></th></tr></thead><tbody>${data.materials.map(material => `<tr><td><strong>${h(material.name)}</strong></td><td><span class="badge material-${h(material.status)}">${{disponible:'Disponible',en_uso:'En uso',reparacion:'En reparación'}[material.status]}</span></td><td>${h(material.hive_name || '—')}</td><td class="cell-notes">${h(material.notes || '—')}</td><td class="row-actions"><a class="icon-button" href="#/materials?${new URLSearchParams({ ...(status ? {status} : {}), ...(q ? {q} : {}), edit: material.id }).toString()}" title="Editar">✎</a><button class="icon-button danger" data-command="material-delete" data-id="${material.id}" title="Eliminar">×</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('⬡', 'No hay materiales', 'Agregue el primero desde el formulario.')}</section></div>`
        });
        updateMaterialForm();
    }

    function updateMaterialForm() {
        const form = document.querySelector('[data-material-form]');
        if (!form) return;
        const status = form.querySelector('[data-material-status]');
        const field = form.querySelector('[data-hive-field]');
        const select = field.querySelector('select');
        const update = () => {
            const visible = status.value === 'en_uso';
            field.style.display = visible ? 'grid' : 'none';
            select.required = visible;
            if (!visible) select.value = '';
        };
        status.addEventListener('change', update);
        update();
    }

    async function renderActivities(params) {
        loading('Cargando el tablero…');
        const filters = { hive_id: params.get('hive_id') || '', label_id: params.get('label_id') || '', q: params.get('q') || '' };
        const data = await api('activities', { params: filters });
        shell({
            title: 'Actividades', subtitle: 'Arrastre las tarjetas para cambiar su estado', active: 'activities',
            actions: '<a class="btn btn-primary" href="#/activity-edit">+ Nueva actividad</a>',
            content: `<form class="filter-bar" data-form="activity-filter"><label class="search-field"><span>⌕</span><input type="search" name="q" value="${h(filters.q)}" placeholder="Buscar actividad"></label><select name="hive_id"><option value="">Todas las colmenas</option>${(data.hives || []).map(item => `<option value="${item.id}" ${String(item.id) === String(filters.hive_id) ? 'selected' : ''}>${h(item.name)}</option>`).join('')}</select><select name="label_id"><option value="">Todas las etiquetas</option>${(data.labels || []).map(item => `<option value="${item.id}" ${String(item.id) === String(filters.label_id) ? 'selected' : ''}>${h(item.name)}</option>`).join('')}</select><button class="btn btn-secondary" type="submit">Filtrar</button><a class="btn btn-ghost" href="#/activities">Limpiar</a></form>
                <section class="kanban-board" data-kanban-board>${(data.statuses || []).map(status => {
                    const cards = (data.activities || []).filter(item => Number(item.status_id) === Number(status.id));
                    const purchases = status.slug === 'pendientes' ? (data.purchase_plans || []) : [];
                    return `<article class="kanban-column"><div class="kanban-header" style="--status-color:${h(status.color)}"><div><span></span><h2>${h(status.name)}</h2></div><strong>${cards.length + purchases.length}</strong></div><div class="kanban-list" data-status-id="${status.id}">${purchases.map(plan => `<article class="kanban-card purchase-kanban-card"><a href="#/purchase/${plan.id}"><div class="kanban-card-top"><span class="activity-label purchase-label">Compra pendiente</span><span class="purchase-card-symbol">▤</span></div><h3>${h(plan.title)}</h3>${plan.notes ? `<p>${h(plan.notes)}</p>` : ''}<div class="kanban-card-meta"><span>▤ ${h(monthLabel(plan.plan_month))}</span><span>${Number(plan.item_count || 0)} elementos</span><span>${moneyARS(plan.total_amount)}</span></div><small>Abrir compra planificada →</small></a></article>`).join('')}${cards.map(activity => `<article class="kanban-card priority-card-${h(activity.priority)}" draggable="true" data-activity-id="${activity.id}"><a href="#/activity-edit/${activity.id}"><div class="kanban-card-top">${activity.label_name ? `<span class="activity-label" style="--label-color:${h(activity.label_color)}">${h(activity.label_name)}</span>` : '<span></span>'}<span class="priority priority-${h(activity.priority)}">${capitalize(activity.priority)}</span></div><h3>${h(activity.title)}</h3>${activity.description ? `<p>${h(activity.description)}</p>` : ''}<div class="kanban-card-meta"><span>⬡ ${h(activity.hive_name || 'Sin colmena')}</span><span>◷ ${formatDate(activity.due_date)}</span></div>${activity.responsible ? `<small>Responsable: ${h(activity.responsible)}</small>` : ''}</a></article>`).join('')}</div></article>`;
                }).join('')}</section>`
        });
        initKanban();
    }

    function initKanban() {
        const board = document.querySelector('[data-kanban-board]');
        if (!board) return;
        let dragged = null;
        board.querySelectorAll('.kanban-card[data-activity-id]').forEach(card => {
            card.addEventListener('dragstart', event => { dragged = card; card.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; });
            card.addEventListener('dragend', () => { card.classList.remove('dragging'); dragged = null; board.querySelectorAll('.kanban-list').forEach(list => list.classList.remove('drag-over')); });
        });
        board.querySelectorAll('.kanban-list').forEach(list => {
            list.addEventListener('dragover', event => {
                event.preventDefault();
                list.classList.add('drag-over');
                if (!dragged) return;
                const cards = [...list.querySelectorAll('.kanban-card:not(.dragging)')];
                const after = cards.find(card => event.clientY <= card.getBoundingClientRect().top + card.offsetHeight / 2);
                after ? list.insertBefore(dragged, after) : list.appendChild(dragged);
            });
            list.addEventListener('dragleave', event => { if (!list.contains(event.relatedTarget)) list.classList.remove('drag-over'); });
            list.addEventListener('drop', async event => {
                event.preventDefault();
                list.classList.remove('drag-over');
                if (!dragged) return;
                const payload = { activity_id: Number(dragged.dataset.activityId), status_id: Number(list.dataset.statusId), ordered_ids: [...list.querySelectorAll('.kanban-card[data-activity-id]')].map(card => Number(card.dataset.activityId)) };
                board.querySelectorAll('.kanban-column').forEach(column => column.querySelector('.kanban-header > strong').textContent = String(column.querySelectorAll('.kanban-card').length));
                try { await api('activity_status_update', { method: 'POST', data: payload }); toast('Estado actualizado'); }
                catch (error) { toast(error.message, 'error'); route(); }
            });
        });
    }

    async function renderActivityEdit(id = 0, params = new URLSearchParams()) {
        loading('Preparando la actividad…');
        const data = await api('activity', { params: { id } });
        const item = data.activity;
        const selectedHive = item?.hive_id || params.get('hive_id') || '';
        shell({
            title: item ? 'Editar actividad' : 'Nueva actividad', subtitle: item ? item.title : 'Cree una tarjeta para el tablero', active: 'activities',
            actions: '<a class="btn btn-ghost" href="#/activities">Volver al tablero</a>',
            content: `<div class="split-layout activity-edit-layout"><section class="form-card"><form data-form="activity-save" enctype="multipart/form-data"><input type="hidden" name="id" value="${item?.id || ''}"><label class="field"><span>Título *</span><input type="text" name="title" maxlength="180" required value="${h(item?.title || '')}" placeholder="Ej.: Alimentar colmena 4"></label><label class="field"><span>Descripción</span><textarea name="description" rows="5" placeholder="Detalle del trabajo">${h(item?.description || '')}</textarea></label><div class="form-grid two-columns"><label class="field"><span>Colmena</span><select name="hive_id"><option value="">Sin colmena</option>${(data.hives || []).map(hive => `<option value="${hive.id}" ${String(hive.id) === String(selectedHive) ? 'selected' : ''}>${h(hive.name)}</option>`).join('')}</select></label><label class="field"><span>Responsable</span><input type="text" name="responsible" maxlength="120" value="${h(item?.responsible || '')}" placeholder="Felipe o Chiara"></label><label class="field"><span>Estado</span><select name="status_id">${(data.statuses || []).map(status => `<option value="${status.id}" ${Number(item?.status_id || 1) === Number(status.id) ? 'selected' : ''}>${h(status.name)}</option>`).join('')}</select></label><label class="field"><span>Etiqueta</span><select name="label_id"><option value="">Sin etiqueta</option>${(data.labels || []).map(label => `<option value="${label.id}" ${Number(item?.label_id || 0) === Number(label.id) ? 'selected' : ''}>${h(label.name)}</option>`).join('')}</select></label><label class="field"><span>Prioridad</span><select name="priority">${['baja','normal','alta','urgente'].map(value => `<option value="${value}" ${(item?.priority || 'normal') === value ? 'selected' : ''}>${capitalize(value)}</option>`).join('')}</select></label><label class="field"><span>Fecha prevista</span><input type="date" name="due_date" value="${h(item?.due_date || '')}"></label></div>${item ? '' : '<label class="field"><span>Adjunto inicial</span><input type="file" name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf"></label>'}<div class="form-actions"><button class="btn btn-primary" type="submit">Guardar actividad</button><a class="btn btn-ghost" href="#/activities">Cancelar</a></div></form>${item ? `<hr><button class="btn btn-danger" data-command="activity-delete" data-id="${item.id}">Eliminar actividad</button>` : ''}</section>
                <div class="activity-side-panels">${item ? `<section class="panel"><div class="panel-header"><div><h2>Archivos adjuntos</h2><p>PDF o fotografías</p></div></div><form class="upload-form vertical" data-form="activity-attachment-upload"><input type="hidden" name="activity_id" value="${item.id}"><input type="file" name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf" required><button class="btn btn-secondary" type="submit">Agregar archivo</button></form>${(data.attachments || []).length ? `<div class="attachment-list">${data.attachments.map(file => `<div><button class="file-link file-button" data-command="open-file" data-file-type="activity" data-id="${file.id}" data-name="${h(file.original_name)}">${h(file.original_name)}</button><small>${formatDateTime(file.uploaded_at)}</small><button class="icon-button danger" data-command="activity-attachment-delete" data-id="${file.id}" data-activity-id="${item.id}">×</button></div>`).join('')}</div>` : '<p class="muted empty-line">No hay archivos adjuntos.</p>'}</section><section class="panel"><div class="panel-header"><div><h2>Historial de cambios</h2><p>Registro de la actividad</p></div></div>${(data.logs || []).length ? `<div class="timeline compact-timeline">${data.logs.map(log => `<div class="timeline-item"><div class="timeline-content"><strong>${h(log.action)}</strong>${log.details ? `<p>${h(log.details)}</p>` : ''}<small>${formatDateTime(log.created_at)}</small></div></div>`).join('')}</div>` : '<p class="muted empty-line">Sin cambios registrados.</p>'}</section>` : `<section class="panel"><div class="empty-state"><div>✓</div><h3>Nueva actividad</h3><p>Después de guardarla podrá adjuntar más archivos y ver su historial.</p></div></section>`}</div></div>`
        });
    }

    async function renderPurchases(params) {
        loading('Cargando compras…');
        const year = params.get('year') || '';
        const showNew = params.get('new') === '1';
        const data = await api('purchases', { params: { year } });
        const pendingPlans = (data.plans || []).filter(plan => (plan.status || 'pendiente') === 'pendiente');
        const completedPlans = (data.plans || []).filter(plan => plan.status === 'realizada');
        const renderCards = (plans, completed = false) => `<section class="purchase-card-grid ${completed ? 'completed-purchases' : ''}">${plans.map(plan => {
            const total = Number(plan.total_amount) || 0;
            const pending = completed ? 0 : Number(plan.pending_amount) || 0;
            const progress = completed ? 100 : (total > 0 ? Math.max(0, Math.min(100, 100 - pending / total * 100)) : 0);
            const monthName = monthLabel(plan.plan_month).replace(/\s+\d{4}$/, '').toUpperCase();
            const yearText = String(plan.plan_month).slice(0,4);
            const badge = completed ? 'Realizada' : (Number(plan.pending_count) > 0 ? `${Number(plan.pending_count)} pendientes` : 'Lista para realizar');
            return `<article class="purchase-card ${completed ? 'purchase-card-completed' : ''}"><a class="purchase-card-main" href="#/purchase/${plan.id}"><div class="purchase-month"><span>${yearText}</span><strong>${h(monthName)}</strong></div><div class="purchase-title"><span class="badge ${completed || Number(plan.pending_count) === 0 ? 'badge-success' : 'badge-warning'}">${badge}</span><h2>${h(plan.title)}</h2><p>${h(plan.notes || 'Sin notas generales')}</p></div><div class="purchase-total"><small>Total estimado</small><strong>${moneyARS(plan.total_amount)}</strong><span>${Number(plan.item_count)} renglones</span></div></a><div class="purchase-progress"><div style="width:${progress}%"></div></div><div class="purchase-card-footer"><span>${completed ? `Realizada: ${formatDateTime(plan.completed_at)}` : `Pendiente: ${moneyARS(plan.pending_amount)}`}</span><a href="#/purchase/${plan.id}">${completed ? 'Ver compra →' : 'Abrir presupuesto →'}</a></div></article>`;
        }).join('')}</section>`;
        shell({
            title: 'Compras pendientes', subtitle: 'Presupuestos organizados por tarjetas mensuales', active: 'purchases',
            actions: '<a class="btn btn-primary" href="#/purchases?new=1">+ Agregar</a>',
            content: `${showNew ? `<section class="panel form-card narrow"><div class="panel-header"><div><h2>Nueva compra pendiente</h2><p>Se guardará como una tarjeta mensual</p></div><a class="icon-button" href="#/purchases">×</a></div><form data-form="purchase-plan-save"><label class="field"><span>Mes *</span><input type="month" name="plan_month" required value="${currentMonth()}"></label><label class="field"><span>Título</span><input type="text" name="title" maxlength="180" placeholder="Si se deja vacío: Compra pendiente de agosto 2026"></label><label class="field"><span>Notas generales</span><textarea name="notes" rows="3" placeholder="Lugar, objetivo o aclaraciones"></textarea></label><button class="btn btn-primary" type="submit">Crear tarjeta</button></form></section>` : ''}<div class="filter-row-simple"><span>Ver año:</span><a class="chip ${!year ? 'active' : ''}" href="#/purchases">Todos</a>${(data.years || []).map(row => `<a class="chip ${String(row.year) === String(year) ? 'active' : ''}" href="#/purchases?year=${row.year}">${row.year}</a>`).join('')}</div><section class="purchase-list-section"><div class="purchase-section-heading"><div><h2>Pendientes</h2><p>Compras abiertas que también aparecen en Actividades.</p></div><span>${pendingPlans.length}</span></div>${pendingPlans.length ? renderCards(pendingPlans) : `<div class="empty-state panel"><div>▤</div><h3>No hay compras pendientes</h3><p>Cree una tarjeta mensual para comenzar.</p><a class="btn btn-primary" href="#/purchases?new=1">Agregar compra pendiente</a></div>`}</section>${completedPlans.length ? `<section class="purchase-list-section completed-section"><div class="purchase-section-heading"><div><h2>Realizadas</h2><p>Compras cerradas que ya generaron materiales disponibles.</p></div><span>${completedPlans.length}</span></div>${renderCards(completedPlans, true)}</section>` : ''}`
        });
    }

    async function renderPurchase(id, params) {
        loading('Cargando compra…');
        const data = await api('purchase', { params: { id } });
        const plan = data.plan;
        const completed = plan.status === 'realizada';
        const editId = completed ? 0 : Number(params.get('edit_item') || 0);
        const editing = editId ? (data.items || []).find(item => Number(item.id) === editId) : null;
        const total = (data.items || []).reduce((sum, item) => sum + Number(item.line_total || 0), 0);
        const pending = completed ? 0 : (data.items || []).reduce((sum, item) => sum + (Number(item.is_purchased) ? 0 : Number(item.line_total || 0)), 0);
        const summaryTail = completed
            ? `<div class="purchase-completed-stamp"><small>Estado</small><strong>REALIZADA</strong><span>${formatDateTime(plan.completed_at)}</span></div>`
            : `<button class="btn btn-success btn-large" data-command="purchase-complete" data-id="${plan.id}" ${(data.items || []).length ? '' : 'disabled'}>REALIZADA</button><div><small>Pendiente</small><strong>${moneyARS(pending)}</strong></div>`;
        const editor = completed ? '' : `<section class="panel sticky-panel"><div class="panel-header"><div><h2>${editing ? 'Editar renglón' : 'Agregar elemento'}</h2><p>El total se calcula automáticamente</p></div></div><form data-form="purchase-item-save" data-purchase-item-form><input type="hidden" name="id" value="${editing?.id || ''}"><input type="hidden" name="plan_id" value="${plan.id}"><label class="field"><span>Elemento *</span><input type="text" name="item_name" required maxlength="180" value="${h(editing?.item_name || '')}" placeholder="Ej.: Alza mediana"></label><div class="form-grid two-columns"><label class="field"><span>Cantidad</span><input type="number" step="0.001" min="0.001" name="quantity" required value="${h(editing?.quantity || '1')}" data-quantity></label><label class="field"><span>Precio unitario</span><input type="number" step="0.01" min="0" name="unit_price" required value="${h(editing?.unit_price || '0')}" data-unit-price></label></div><div class="calculated-total"><small>Total del renglón</small><strong data-line-total>${moneyARS(Number(editing?.quantity || 1) * Number(editing?.unit_price || 0))}</strong></div><label class="field"><span>Lugar de compra</span><input type="text" name="purchase_place" maxlength="180" value="${h(editing?.purchase_place || '')}" placeholder="Proveedor o comercio"></label><label class="field"><span>Notas</span><textarea name="notes" rows="3">${h(editing?.notes || '')}</textarea></label><label class="checkbox-field"><input type="checkbox" name="is_purchased" value="1" ${Number(editing?.is_purchased || 0) ? 'checked' : ''}><span>Ya fue comprado</span></label><div class="form-actions"><button class="btn btn-primary" type="submit">${editing ? 'Guardar cambios' : '+ Agregar elemento'}</button>${editing ? `<a class="btn btn-ghost" href="#/purchase/${plan.id}">Cancelar</a>` : ''}</div></form><details><summary>Editar datos de la tarjeta</summary><form class="details-form" data-form="purchase-plan-save"><input type="hidden" name="id" value="${plan.id}"><label class="field"><span>Título</span><input name="title" value="${h(plan.title)}" required></label><label class="field"><span>Mes</span><input type="month" name="plan_month" value="${h(String(plan.plan_month).slice(0,7))}" required></label><label class="field"><span>Notas</span><textarea name="notes" rows="3">${h(plan.notes || '')}</textarea></label><button class="btn btn-secondary" type="submit">Actualizar tarjeta</button></form></details><button class="btn btn-danger" data-command="purchase-plan-delete" data-id="${plan.id}">Eliminar tarjeta completa</button></section>`;
        shell({
            title: plan.title, subtitle: completed ? 'Compra realizada' : 'Detalle del presupuesto planificado', active: 'purchases',
            actions: '<a class="btn btn-ghost" href="#/purchases">Volver a tarjetas</a>',
            content: `<section class="purchase-summary panel ${completed ? 'purchase-summary-completed' : ''}"><div><span class="purchase-summary-icon">▤</span><div><small>${completed ? 'Compra realizada' : 'Compra planificada'}</small><h2>${h(monthLabel(plan.plan_month))}</h2><p>${h(plan.notes || 'Sin notas generales')}</p></div></div><div><small>Total estimado</small><strong>${moneyARS(total)}</strong></div>${summaryTail}</section><div class="split-layout purchase-edit-layout ${completed ? 'purchase-layout-completed' : ''}">${editor}<section class="panel ${completed ? 'purchase-readonly-panel' : ''}"><div class="panel-header"><div><h2>Presupuesto</h2><p>${(data.items || []).length} renglones${completed ? ' · compra cerrada' : ''}</p></div></div>${(data.items || []).length ? `<div class="table-wrap"><table class="data-table purchase-table"><thead><tr><th>Estado</th><th>Elemento</th><th>Cantidad</th><th>Precio unit.</th><th>Total</th><th>Lugar</th>${completed ? '' : '<th></th>'}</tr></thead><tbody>${data.items.map(item => `<tr class="${completed || Number(item.is_purchased) ? 'row-completed' : ''}"><td><span class="badge ${completed || Number(item.is_purchased) ? 'badge-success' : 'badge-warning'}">${completed || Number(item.is_purchased) ? 'Comprado' : 'Pendiente'}</span></td><td><strong>${h(item.item_name)}</strong>${item.notes ? `<small>${h(item.notes)}</small>` : ''}</td><td>${number3(item.quantity)}</td><td>${moneyARS(item.unit_price)}</td><td><strong>${moneyARS(item.line_total)}</strong></td><td>${h(item.purchase_place || '—')}</td>${completed ? '' : `<td class="row-actions"><a class="icon-button" href="#/purchase/${plan.id}?edit_item=${item.id}">✎</a><button class="icon-button danger" data-command="purchase-item-delete" data-id="${item.id}" data-plan-id="${plan.id}">×</button></td>`}</tr>`).join('')}</tbody></table></div>` : emptyState('▤', 'Presupuesto vacío', 'Agregue el primer elemento desde el formulario.')}${completed ? `<div class="closed-purchase-note">Los materiales de esta compra ya fueron agregados automáticamente en estado <strong>Disponible</strong>.</div><button class="btn btn-danger completed-delete-form" data-command="purchase-plan-delete" data-id="${plan.id}">Eliminar tarjeta completa</button>` : ''}</section></div>`
        });
        initPurchaseCalculation();
    }

    function initPurchaseCalculation() {
        const form = document.querySelector('[data-purchase-item-form]');
        if (!form) return;
        const quantity = form.querySelector('[data-quantity]');
        const price = form.querySelector('[data-unit-price]');
        const total = form.querySelector('[data-line-total]');
        const update = () => total.textContent = moneyARS((Number(quantity.value) || 0) * (Number(price.value) || 0));
        quantity.addEventListener('input', update); price.addEventListener('input', update); update();
    }

    async function renderAccounting(params) {
        loading('Cargando contabilidad…');
        const filters = Object.fromEntries(params.entries());
        const edit = Number(filters.edit || 0);
        delete filters.edit;
        const data = await api('accounting', { params: filters });
        const editing = edit ? (data.entries || []).find(item => Number(item.id) === edit) || null : null;
        const summary = data.summary || {};
        shell({
            title: 'Contabilidad', subtitle: 'Toda la existencia del proyecto con filtros por período', active: 'accounting',
            content: `<section class="balance-strip accounting-balances"><div class="balance-strip-title"><span>Saldo histórico por persona</span><small>Siempre muestra toda la existencia del proyecto</small></div>${(data.balances || []).map(balance => `<div class="person-balance ${Number(balance.balance_ars) < 0 ? 'negative' : 'positive'}"><strong>${h(balance.name)}</strong><span>${moneyUSD(balance.balance_usd)}</span><small>${moneyARS(balance.balance_ars)}</small></div>`).join('')}</section>
                <form class="filter-panel panel" data-form="accounting-filter"><div class="filter-panel-title"><strong>Filtrar movimientos</strong><small>Por ejemplo: desde octubre hasta noviembre de cualquier año</small></div><label class="field"><span>Desde</span><input type="date" name="date_from" value="${h(filters.date_from || '')}"></label><label class="field"><span>Hasta</span><input type="date" name="date_to" value="${h(filters.date_to || '')}"></label><label class="field"><span>Persona</span><select name="person_id"><option value="">Todas</option>${(data.people || []).map(person => `<option value="${person.id}" ${String(person.id) === String(filters.person_id || '') ? 'selected' : ''}>${h(person.name)}</option>`).join('')}</select></label><label class="field"><span>Tipo</span><select name="movement_type"><option value="">Ingresos y egresos</option><option value="ingreso" ${filters.movement_type === 'ingreso' ? 'selected' : ''}>Ingresos</option><option value="egreso" ${filters.movement_type === 'egreso' ? 'selected' : ''}>Egresos</option></select></label><label class="field"><span>Concepto</span><select name="concept_id"><option value="">Todos</option>${(data.concepts || []).map(concept => `<option value="${concept.id}" ${String(concept.id) === String(filters.concept_id || '') ? 'selected' : ''}>${h(concept.name)}</option>`).join('')}</select></label><label class="field filter-search"><span>Texto</span><input type="search" name="q" value="${h(filters.q || '')}" placeholder="Buscar en descripción"></label><div class="filter-actions"><button class="btn btn-secondary" type="submit">Aplicar filtros</button><a class="btn btn-ghost" href="#/accounting">Ver todo</a></div></form>
                <section class="accounting-summary-grid"><article><small>Ingresos del resultado</small><strong class="income-text">${moneyUSD(summary.income_usd)}</strong><span>${moneyARS(summary.income_ars)}</span></article><article><small>Egresos del resultado</small><strong class="expense-text">${moneyUSD(summary.expense_usd)}</strong><span>${moneyARS(summary.expense_ars)}</span></article><article><small>Balance del resultado</small><strong>${moneyUSD(Number(summary.income_usd || 0)-Number(summary.expense_usd || 0))}</strong><span>${moneyARS(Number(summary.income_ars || 0)-Number(summary.expense_ars || 0))}</span></article><article><small>Movimientos encontrados</small><strong>${Number(summary.total || 0)}</strong><span>registros</span></article></section>
                <div class="split-layout accounting-layout"><section class="panel sticky-panel"><div class="panel-header"><div><h2>${editing ? 'Editar movimiento' : 'Agregar movimiento'}</h2><p>La conversión a dólares se calcula sola</p></div></div><form data-form="accounting-save" data-accounting-form enctype="multipart/form-data"><input type="hidden" name="id" value="${editing?.id || ''}"><label class="field"><span>Fecha *</span><input type="date" name="entry_date" required value="${h(editing?.entry_date || today())}"></label><label class="field"><span>Persona *</span><select name="person_id" required><option value="">Seleccione</option>${(data.people || []).map(person => `<option value="${person.id}" ${Number(editing?.person_id || 0) === Number(person.id) ? 'selected' : ''}>${h(person.name)}</option>`).join('')}</select></label><label class="field"><span>Concepto *</span><select name="concept_id" required data-concept-select><option value="">Seleccione</option>${(data.concepts || []).map(concept => `<option value="${concept.id}" data-default-type="${h(concept.default_type)}" ${Number(editing?.concept_id || 0) === Number(concept.id) ? 'selected' : ''}>${h(concept.name)}</option>`).join('')}</select></label><label class="field"><span>Tipo *</span><select name="movement_type" required data-movement-type><option value="egreso" ${(editing?.movement_type || 'egreso') === 'egreso' ? 'selected' : ''}>Egreso / gasto</option><option value="ingreso" ${editing?.movement_type === 'ingreso' ? 'selected' : ''}>Ingreso / venta</option></select></label><label class="field"><span>Importe en pesos *</span><input type="number" step="0.01" min="0.01" name="amount_ars" required value="${h(editing?.amount_ars || '')}" data-amount-ars placeholder="0,00"></label><label class="field"><span>Cotización del dólar *</span><input type="number" step="0.0001" min="0.0001" name="usd_rate" required value="${h(editing?.usd_rate || '')}" data-usd-rate placeholder="Ej.: 1350"></label><div class="calculated-total accounting-usd"><small>Equivalente guardado</small><strong data-amount-usd>${moneyUSD(editing?.amount_usd || 0)}</strong></div><label class="field"><span>Descripción</span><textarea name="description" rows="4" placeholder="Qué se compró, vendió o pagó">${h(editing?.description || '')}</textarea></label><label class="field"><span>Comprobante</span><input type="file" name="receipt" accept="image/jpeg,image/png,image/webp,application/pdf"><small>${editing?.receipt_original_name ? `Actual: ${h(editing.receipt_original_name)}. Cargue otro para reemplazarlo.` : 'PDF, JPG, PNG o WEBP.'}</small></label><div class="form-actions"><button class="btn btn-primary" type="submit">${editing ? 'Guardar cambios' : '+ Agregar movimiento'}</button>${editing ? '<a class="btn btn-ghost" href="#/accounting">Cancelar</a>' : ''}</div></form></section><section class="panel"><div class="panel-header"><div><h2>Movimientos</h2><p>Resultado de los filtros seleccionados</p></div></div>${(data.entries || []).length ? `<div class="table-wrap"><table class="data-table accounting-table"><thead><tr><th>Fecha</th><th>Persona</th><th>Concepto</th><th>Descripción</th><th>Pesos</th><th>Dólares</th><th>Comprobante</th><th></th></tr></thead><tbody>${data.entries.map(entry => `<tr><td>${formatDate(entry.entry_date)}</td><td><strong>${h(entry.person_name)}</strong></td><td><span class="badge ${entry.movement_type === 'ingreso' ? 'badge-success' : 'badge-danger-soft'}">${h(entry.concept_name)}</span></td><td class="cell-notes">${h(entry.description || '—')}</td><td class="${entry.movement_type === 'ingreso' ? 'income-text' : 'expense-text'}"><strong>${entry.movement_type === 'ingreso' ? '+ ' : '- '}${moneyARS(entry.amount_ars)}</strong></td><td>${moneyUSD(entry.amount_usd)}<small>@ ${moneyARS(entry.usd_rate)}</small></td><td>${entry.receipt_relative_path ? `<button class="file-link file-button" data-command="open-file" data-file-type="receipt" data-id="${entry.id}" data-name="${h(entry.receipt_original_name || 'comprobante')}">Ver archivo</button>` : '—'}</td><td class="row-actions"><a class="icon-button" href="#/accounting?${new URLSearchParams({...filters, edit: entry.id}).toString()}">✎</a><button class="icon-button danger" data-command="accounting-delete" data-id="${entry.id}">×</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('$', 'No hay movimientos', 'No existen registros con estos filtros.')}</section></div>`
        });
        initAccountingCalculation();
    }

    function initAccountingCalculation() {
        const form = document.querySelector('[data-accounting-form]');
        if (!form) return;
        const ars = form.querySelector('[data-amount-ars]');
        const rate = form.querySelector('[data-usd-rate]');
        const usd = form.querySelector('[data-amount-usd]');
        const concept = form.querySelector('[data-concept-select]');
        const type = form.querySelector('[data-movement-type]');
        const update = () => usd.textContent = moneyUSD((Number(rate.value) || 0) > 0 ? (Number(ars.value) || 0) / Number(rate.value) : 0);
        ars.addEventListener('input', update); rate.addEventListener('input', update); update();
        concept.addEventListener('change', () => { const selected = concept.selectedOptions[0]; if (selected?.dataset.defaultType) type.value = selected.dataset.defaultType; });
    }

    async function renderBackups() {
        loading('Cargando copias de seguridad…');
        const data = await api('backups');
        shell({
            title: 'Copias de seguridad', subtitle: 'Un único ZIP con tablas, PDFs, imágenes y todos los adjuntos', active: 'backups',
            content: `<section class="backup-hero panel"><div class="backup-illustration">⇩</div><div><h2>Descargar copia completa</h2><p>Genera en el momento un archivo ZIP con la base SQL y todo el contenido de las carpetas de archivos.</p><ul><li>Colmenas, actividades, materiales, compras y contabilidad.</li><li>PDF, fotografías y comprobantes.</li><li>Archivo de restauración y manifiesto de la copia.</li></ul></div><button class="btn btn-primary btn-large" data-command="backup-create">Descargar TODO en ZIP</button></section><section class="restore-panel panel"><div class="panel-header"><div><h2>Restaurar una copia</h2><p>Reemplaza los datos actuales por los incluidos en el ZIP</p></div></div><div class="warning-box"><strong>Protección automática:</strong> antes de restaurar, el sistema genera una copia completa del estado actual.</div><form class="restore-form" data-form="backup-restore" enctype="multipart/form-data"><input type="file" name="backup_zip" accept="application/zip,.zip" required><button class="btn btn-warning" type="submit">Restaurar ZIP seleccionado</button></form></section><section class="panel"><div class="panel-header"><div><h2>Copias generadas</h2><p>También quedan guardadas localmente hasta que las elimine</p></div></div>${(data.backups || []).length ? `<div class="backup-list">${data.backups.map(backup => `<div class="backup-row"><div class="backup-file-icon">ZIP</div><div><strong>${h(backup.filename)}</strong><small>${formatDateTime(backup.created_at)} · ${(Number(backup.size_bytes || 0)/1024/1024).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})} MB</small></div><button class="btn btn-small btn-secondary" data-command="backup-download" data-id="${backup.id}" data-name="${h(backup.filename)}">Descargar</button><button class="icon-button danger" data-command="backup-delete" data-id="${backup.id}">×</button></div>`).join('')}</div>` : '<p class="muted empty-line">Todavía no se generó ninguna copia.</p>'}</section>`
        });
    }

    async function renderProfile() {
        loading('Cargando la cuenta…');
        const data = await api('me');
        state.user = data.user;
        localStorage.setItem(STORAGE.user, JSON.stringify(state.user));
        shell({
            title: 'Mi cuenta', subtitle: 'Seguridad del usuario actual', active: '',
            content: `<div class="split-layout account-layout"><section class="panel"><div class="panel-header"><div><h2>Datos del usuario</h2><p>Cuenta actualmente conectada</p></div></div><dl class="account-details"><div><dt>Nombre</dt><dd>${h(data.user.display_name)}</dd></div><div><dt>Usuario</dt><dd>${h(data.user.username)}</dd></div><div><dt>Último ingreso</dt><dd>${formatDateTime(data.user.last_login_at)}</dd></div></dl></section><section class="form-card"><div class="panel-header"><div><h2>Cambiar contraseña</h2><p>La nueva contraseña se guarda cifrada.</p></div></div><form class="form-grid" data-form="change-password"><label class="field"><span>Contraseña actual</span><input type="password" name="current_password" required autocomplete="current-password"></label><label class="field"><span>Nueva contraseña</span><input type="password" name="new_password" minlength="12" required autocomplete="new-password"></label><label class="field"><span>Repetir nueva contraseña</span><input type="password" name="new_password_confirm" minlength="12" required autocomplete="new-password"></label><small class="password-help">Mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo.</small><button class="btn btn-primary" type="submit">Guardar nueva contraseña</button></form></section></div>`
        });
    }

    async function hydrateProtectedImages() {
        const images = [...document.querySelectorAll('[data-protected-image]')];
        await Promise.all(images.map(async image => {
            try {
                const blob = await api('file', { params: { type: image.dataset.fileType, id: image.dataset.id }, blob: true });
                const url = URL.createObjectURL(blob);
                state.protectedUrls.push(url);
                image.src = url;
            } catch (_) {
                image.alt = 'No se pudo cargar la imagen';
            }
        }));
    }

    async function downloadBlob(action, params, filename, method = 'GET', formData = null) {
        const blob = await api(action, { params, method, formData, blob: true });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename || 'archivo';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }

    async function openProtectedFile(type, id, name) {
        const blob = await api('file', { params: { type, id }, blob: true });
        const url = URL.createObjectURL(blob);
        state.protectedUrls.push(url);
        const windowRef = window.open(url, '_blank', 'noopener');
        if (!windowRef) await downloadBlob('file', { type, id }, name || 'archivo');
    }

    async function route() {
        if (!state.token) {
            renderLogin();
            return;
        }
        const { path, params } = parseHash();
        try {
            if (path === '/' || path === '/dashboard') return await renderDashboard();
            if (path === '/hives') return await renderHives(params);
            if (/^\/hive\/\d+$/.test(path)) return await renderHive(Number(path.split('/')[2]));
            if (path === '/hive-edit') return await renderHiveEdit();
            if (/^\/hive-edit\/\d+$/.test(path)) return await renderHiveEdit(Number(path.split('/')[2]));
            if (path === '/materials') return await renderMaterials(params);
            if (path === '/activities') return await renderActivities(params);
            if (path === '/activity-edit') return await renderActivityEdit(0, params);
            if (/^\/activity-edit\/\d+$/.test(path)) return await renderActivityEdit(Number(path.split('/')[2]), params);
            if (path === '/purchases') return await renderPurchases(params);
            if (/^\/purchase\/\d+$/.test(path)) return await renderPurchase(Number(path.split('/')[2]), params);
            if (path === '/accounting') return await renderAccounting(params);
            if (path === '/backups') return await renderBackups();
            if (path === '/profile') return await renderProfile();
            go('/dashboard');
        } catch (error) {
            if (!state.token) return;
            shell({ title: 'No se pudo abrir', subtitle: 'Problema de conexión con el servidor local', active: '', content: `<section class="panel api-offline-box"><div class="empty-state"><div>!</div><h3>${h(error.message)}</h3><p>La interfaz está publicada, pero necesita que la computadora con Laragon y Cloudflare Tunnel esté encendida.</p><div class="inline-buttons"><button class="btn btn-primary" data-command="retry-route">Volver a intentar</button><button class="btn btn-ghost" data-command="show-login">Cambiar servidor</button></div></div></section>` });
        }
    }

    document.addEventListener('submit', async event => {
        const form = event.target.closest('form[data-form]');
        if (!form) return;
        event.preventDefault();
        const type = form.dataset.form;
        const button = form.querySelector('button[type="submit"]');
        const oldText = button?.textContent;
        form.classList.add('is-submitting');
        if (button) { button.disabled = true; button.textContent = 'Guardando…'; }
        try {
            if (type === 'server-config') {
                const url = form.elements.api_url.value;
                saveApiUrl(url);
                const health = await api('health', { noAuth: true });
                toast(`Servidor conectado: ${health.service}`);
                renderLogin();
            } else if (type === 'login') {
                if (!state.apiUrl) throw new Error('Abra “Configurar conexión con Laragon” e ingrese la dirección pública.');
                const result = await api('login', { method: 'POST', noAuth: true, data: { username: form.elements.username.value, password: form.elements.password.value } });
                saveSession(result.token, result.user);
                if (!availableApps(result.user).includes('apicultura') && availableApps(result.user).includes('ganaderia')) { window.location.href = 'ganaderia.html'; return; }
                if (!location.hash || location.hash === '#/') location.hash = '#/dashboard'; else await route();
            } else if (type === 'hive-filter') {
                const fd = new FormData(form); go('/hives', Object.fromEntries(fd.entries()));
            } else if (type === 'hive-save') {
                const result = await api('hive_save', { method: 'POST', data: Object.fromEntries(new FormData(form).entries()) }); toast(result.message); go(`/hive/${result.id}`);
            } else if (type === 'hive-note-save') {
                await api('hive_note_save', { method: 'POST', data: Object.fromEntries(new FormData(form).entries()) }); toast('Observación agregada'); await route();
            } else if (type === 'hive-queen-save') {
                await api('hive_queen_save', { method: 'POST', data: Object.fromEntries(new FormData(form).entries()) }); toast('Nueva reina agregada al historial'); await route(); revealQueenHistory(true);
            } else if (type === 'apiculture-banner-upload') {
                await api('apiculture_banner_upload', { method: 'POST', formData: new FormData(form) }); toast('Banner del inicio actualizado'); await route();
            } else if (type === 'hive-photo-upload') {
                await api('hive_photo_upload', { method: 'POST', formData: new FormData(form) }); toast('Archivo agregado'); await route();
            } else if (type === 'material-filter') {
                const fd = new FormData(form); go('/materials', Object.fromEntries(fd.entries()));
            } else if (type === 'material-save') {
                await api('material_save', { method: 'POST', data: Object.fromEntries(new FormData(form).entries()) }); toast('Material guardado'); go('/materials');
            } else if (type === 'activity-filter') {
                const fd = new FormData(form); go('/activities', Object.fromEntries(fd.entries()));
            } else if (type === 'activity-save') {
                const result = await api('activity_save', { method: 'POST', formData: new FormData(form) }); toast(result.message); go(`/activity-edit/${result.id}`);
            } else if (type === 'activity-attachment-upload') {
                await api('activity_attachment_upload', { method: 'POST', formData: new FormData(form) }); toast('Archivo agregado'); await route();
            } else if (type === 'purchase-plan-save') {
                const result = await api('purchase_plan_save', { method: 'POST', data: Object.fromEntries(new FormData(form).entries()) }); toast(result.message); go(`/purchase/${result.id}`);
            } else if (type === 'purchase-item-save') {
                const fd = new FormData(form); const obj = Object.fromEntries(fd.entries()); obj.is_purchased = form.elements.is_purchased.checked ? 1 : 0; await api('purchase_item_save', { method: 'POST', data: obj }); toast('Renglón guardado'); go(`/purchase/${obj.plan_id}`);
            } else if (type === 'accounting-filter') {
                go('/accounting', Object.fromEntries(new FormData(form).entries()));
            } else if (type === 'accounting-save') {
                await api('accounting_save', { method: 'POST', formData: new FormData(form) }); toast('Movimiento guardado'); go('/accounting');
            } else if (type === 'backup-restore') {
                if (!confirm('¿Restaurar esta copia? Los datos actuales serán reemplazados. Se generará primero un respaldo automático.')) return;
                await api('backup_restore', { method: 'POST', formData: new FormData(form) }); clearSession(); toast('Copia restaurada. Vuelva a ingresar.'); renderLogin();
            } else if (type === 'change-password') {
                const result = await api('change_password', { method: 'POST', data: Object.fromEntries(new FormData(form).entries()) }); toast(result.message); form.reset();
            }
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            form.classList.remove('is-submitting');
            if (button) { button.disabled = false; button.textContent = oldText; }
        }
    });

    document.addEventListener('click', async event => {
        const commandElement = event.target.closest('[data-command]');
        if (!commandElement) return;
        const command = commandElement.dataset.command;
        try {
            if (command === 'app-switch-toggle') {
                const switcher = commandElement.closest('.app-switcher');
                const menu = switcher?.querySelector('.app-switch-menu');
                if (menu) { menu.hidden = !menu.hidden; commandElement.setAttribute('aria-expanded', String(!menu.hidden)); }
            } else if (command === 'switch-app') {
                const target = commandElement.dataset.app;
                if (target === 'ganaderia' && canAccessApp('ganaderia')) window.location.href = 'ganaderia.html#/ganaderia';
                if (target === 'apicultura' && canAccessApp('apicultura')) window.location.href = 'index.html#/dashboard';
            } else if (command === 'banner-editor-toggle') {
                const editor = document.querySelector('[data-banner-editor]');
                if (editor) editor.hidden = !editor.hidden;
            } else if (command === 'logout') {
                try { await api('logout', { method: 'POST', data: {} }); } catch (_) {}
                clearSession(); renderLogin();
            } else if (command === 'retry-route') {
                await route();
            } else if (command === 'show-login') {
                clearSession(); renderLogin();
            } else if (command === 'hive-delete') {
                if (!confirm('¿Eliminar esta colmena? Se eliminarán sus observaciones y fotos. Los materiales y actividades quedarán sin colmena.')) return;
                await api('hive_delete', { method: 'POST', data: { id: commandElement.dataset.id } }); toast('Colmena eliminada'); go('/hives');
            } else if (command === 'hive-note-delete') {
                if (!confirm('¿Eliminar esta observación?')) return;
                await api('hive_note_delete', { method: 'POST', data: { id: commandElement.dataset.id, hive_id: commandElement.dataset.hiveId } }); toast('Observación eliminada'); await route();
            } else if (command === 'queen-history-toggle') {
                const panel = document.querySelector('[data-queen-history]');
                if (panel) {
                    panel.hidden = !panel.hidden;
                    document.querySelectorAll('[data-command="queen-history-toggle"]').forEach(button => button.setAttribute('aria-expanded', String(!panel.hidden)));
                    if (!panel.hidden) setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'center' }), 30);
                }
            } else if (command === 'hive-queen-delete') {
                if (!confirm('¿Eliminar este registro del historial de reinas?')) return;
                await api('hive_queen_delete', { method: 'POST', data: { id: commandElement.dataset.id, hive_id: commandElement.dataset.hiveId } }); toast('Registro de reina eliminado'); await route(); revealQueenHistory(false);
            } else if (command === 'hive-photo-cover') {
                await api('hive_photo_cover', { method: 'POST', data: { id: commandElement.dataset.id, hive_id: commandElement.dataset.hiveId } }); toast('Banner de la colmena actualizado'); await route();
            } else if (command === 'hive-photo-delete') {
                if (!confirm('¿Eliminar este archivo?')) return;
                await api('hive_photo_delete', { method: 'POST', data: { id: commandElement.dataset.id, hive_id: commandElement.dataset.hiveId } }); toast('Archivo eliminado'); await route();
            } else if (command === 'apiculture-banner-delete') {
                if (!confirm('¿Quitar la imagen del inicio?')) return;
                await api('apiculture_banner_delete', { method: 'POST', data: {} }); toast('Banner eliminado'); await route();
            } else if (command === 'material-delete') {
                if (!confirm('¿Eliminar este material?')) return;
                await api('material_delete', { method: 'POST', data: { id: commandElement.dataset.id } }); toast('Material eliminado'); await route();
            } else if (command === 'activity-delete') {
                if (!confirm('¿Eliminar esta actividad y sus archivos?')) return;
                await api('activity_delete', { method: 'POST', data: { id: commandElement.dataset.id } }); toast('Actividad eliminada'); go('/activities');
            } else if (command === 'activity-attachment-delete') {
                if (!confirm('¿Eliminar este archivo?')) return;
                await api('activity_attachment_delete', { method: 'POST', data: { id: commandElement.dataset.id, activity_id: commandElement.dataset.activityId } }); toast('Archivo eliminado'); await route();
            } else if (command === 'purchase-plan-delete') {
                if (!confirm('¿Eliminar esta tarjeta mensual y todos sus renglones?')) return;
                await api('purchase_plan_delete', { method: 'POST', data: { id: commandElement.dataset.id } }); toast('Tarjeta eliminada'); go('/purchases');
            } else if (command === 'purchase-complete') {
                if (!confirm('¿Marcar esta compra como REALIZADA? Se cerrará y sus elementos se agregarán a Materiales como disponibles.')) return;
                const response = await api('purchase_complete', { method: 'POST', data: { id: commandElement.dataset.id } });
                toast(response.message || 'Compra realizada.');
                await route();
            } else if (command === 'purchase-item-delete') {
                if (!confirm('¿Eliminar este renglón?')) return;
                await api('purchase_item_delete', { method: 'POST', data: { id: commandElement.dataset.id, plan_id: commandElement.dataset.planId } }); toast('Renglón eliminado'); await route();
            } else if (command === 'accounting-delete') {
                if (!confirm('¿Eliminar este movimiento y su comprobante?')) return;
                await api('accounting_delete', { method: 'POST', data: { id: commandElement.dataset.id } }); toast('Movimiento eliminado'); await route();
            } else if (command === 'backup-create') {
                commandElement.disabled = true; const text = commandElement.textContent; commandElement.textContent = 'Generando ZIP…';
                try { await downloadBlob('backup_create', {}, `apicultura_completa_${today()}.zip`, 'POST', new FormData()); toast('Copia completa descargada'); await route(); } finally { commandElement.disabled = false; commandElement.textContent = text; }
            } else if (command === 'backup-download') {
                await downloadBlob('file', { type: 'backup', id: commandElement.dataset.id }, commandElement.dataset.name);
            } else if (command === 'backup-delete') {
                if (!confirm('¿Eliminar esta copia del disco?')) return;
                await api('backup_delete', { method: 'POST', data: { id: commandElement.dataset.id } }); toast('Copia eliminada'); await route();
            } else if (command === 'open-file') {
                await openProtectedFile(commandElement.dataset.fileType, commandElement.dataset.id, commandElement.dataset.name);
            }
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    window.addEventListener('hashchange', route);

    async function init() {
        if (!state.token) {
            renderLogin();
            return;
        }
        try {
            const result = await api('me');
            state.user = result.user;
            localStorage.setItem(STORAGE.user, JSON.stringify(state.user));
            if (!canAccessApp('apicultura') && canAccessApp('ganaderia')) { window.location.href = 'ganaderia.html'; return; }
            if (!location.hash) location.hash = '#/dashboard'; else await route();
        } catch (_) {
            clearSession();
            renderLogin();
        }
    }

    init();
})();
