(() => {
    'use strict';

    const app = document.getElementById('app');
    const toastStack = document.getElementById('toast-stack');
    const config = window.APICULTURA_CONFIG || {};
    const DEFAULT_API_URL = 'https://api.mellifera-technology.com/apicultura/api/index.php';
    const STORAGE = {
        apiUrl: 'apicultura_api_url',
        token: 'apicultura_api_token',
        user: 'apicultura_api_user'
    };

    const state = {
        apiUrl: config.apiUrl || DEFAULT_API_URL,
        token: localStorage.getItem(STORAGE.token) || '',
        user: JSON.parse(localStorage.getItem(STORAGE.user) || 'null'),
        protectedUrls: [],
        imageCache: new Map(),
        navigationOrder: null,
        archivedActivities: [],
        laRudaData: null,
        materialCategories: [],
        apiaryTechnical: {}
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
    const number3 = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0));
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
        state.imageCache.forEach(url => URL.revokeObjectURL(url));
        state.imageCache.clear();
        state.protectedUrls = [];
    }

    function invalidateImageCache(fileType = '', id = '') {
        [...state.imageCache.entries()].forEach(([key, url]) => {
            const matchesType = !fileType || key.includes(`:${fileType}:`) || key.startsWith(`${fileType}:`);
            const matchesId = !id || key.endsWith(`:${id}`) || key === `${fileType}:${id}`;
            if (matchesType && matchesId) {
                URL.revokeObjectURL(url);
                state.imageCache.delete(key);
            }
        });
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
        const fetchOptions = { method, headers, cache: options.blob ? 'default' : 'no-store' };
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
        const currentLabel = current === 'ganaderia' ? 'Gestión Ganadera' : current === 'comunidad' ? 'Comunidad Apícola' : 'Gestión Apícola';
        const currentIcon = current === 'ganaderia' ? '⌾' : current === 'comunidad' ? '✦' : '🐝';
        if (apps.length < 2) {
            return `<a class="brand" href="${current === 'ganaderia' ? 'ganaderia.html#/ganaderia' : '#/dashboard'}"><span class="brand-icon ${current === 'ganaderia' ? 'livestock-brand-icon' : ''}">${currentIcon}</span><span><strong>${currentLabel}</strong><small>Acceso privado</small></span></a>`;
        }
        return `<div class="app-switcher"><button class="brand app-switcher-trigger" type="button" data-command="app-switch-toggle" aria-expanded="false"><span class="brand-icon ${current === 'ganaderia' ? 'livestock-brand-icon' : ''}">${currentIcon}</span><span><strong>${currentLabel}</strong><small>Cambiar de vista</small></span><span class="app-switch-chevron">⌄</span></button><div class="app-switch-menu" hidden>${apps.includes('apicultura') ? `<button type="button" data-command="switch-app" data-app="apicultura" class="${current === 'apicultura' ? 'active' : ''}"><span>🐝</span><div><strong>Gestión Apícola</strong><small>Colmenas y apiario</small></div></button>` : ''}${apps.includes('ganaderia') ? `<button type="button" data-command="switch-app" data-app="ganaderia" class="${current === 'ganaderia' ? 'active' : ''}"><span>⌾</span><div><strong>Gestión Ganadera</strong><small>Animales y parcelas</small></div></button>` : ''}${apps.includes('comunidad') ? `<button type="button" data-command="switch-app" data-app="comunidad" class="${current === 'comunidad' ? 'active' : ''}"><span>⬢</span><div><strong>Comunidad Apícola</strong><small>Trabajo compartido</small></div></button>` : ''}</div></div>`;
    }

    const navItems = [
        ['/dashboard', '⌂', 'Inicio', 'dashboard'],
        ['/hives', '▦', 'Colmenas', 'hives'],
        ['/activities', '✓', 'Actividades', 'activities'],
        ['/materials', '⬡', 'Materiales', 'materials'],
        ['/accounting', '$', 'Contabilidad', 'accounting'],
        ['/documents', '▤', 'Documentos', 'documents'],
        ['/queen-rearing', '♛', 'Crianza de reinas', 'queen-rearing'],
        ['/apiario-la-ruda', '◆', 'Apiario La Ruda', 'la-ruda'],
        ['/backups', '⇩', 'Copias de seguridad', 'backups']
    ];


    function orderedNavigationItems() {
        const order = Array.isArray(state.navigationOrder) ? state.navigationOrder : [];
        const byKey = new Map(navItems.map(item => [item[3], item]));
        const result = order.map(key => byKey.get(key)).filter(Boolean);
        navItems.forEach(item => { if (!result.some(row => row[3] === item[3])) result.push(item); });
        return result;
    }

    async function ensureNavigationOrder() {
        if (Array.isArray(state.navigationOrder)) return;
        try {
            const result = await api('navigation_get', { params: { app_code: 'apicultura' } });
            state.navigationOrder = Array.isArray(result.order) ? result.order : [];
        } catch (_) { state.navigationOrder = []; }
    }

    function navigationOrderRows(items = orderedNavigationItems()) {
        return `<div class="navigation-order-list" data-navigation-order-list>${items.map(([path,icon,label,key]) => `<article class="navigation-order-row" draggable="true" data-nav-key="${h(key)}"><span class="navigation-drag-handle" title="Arrastrar">⋮⋮</span><span class="navigation-order-icon">${icon}</span><strong>${h(label)}</strong><div><button class="icon-button" type="button" data-command="nav-order-move" data-direction="up" aria-label="Subir">↑</button><button class="icon-button" type="button" data-command="nav-order-move" data-direction="down" aria-label="Bajar">↓</button></div></article>`).join('')}</div><div class="form-actions"><button class="btn btn-primary" type="button" data-command="nav-order-save">Guardar mi orden</button><button class="btn btn-ghost" type="button" data-command="nav-order-reset">Restablecer</button></div>`;
    }

    function initNavigationOrderEditor() {
        const list = document.querySelector('[data-navigation-order-list]');
        if (!list) return;
        let dragged = null;
        list.querySelectorAll('[data-nav-key]').forEach(row => {
            row.addEventListener('dragstart', () => { dragged = row; row.classList.add('dragging'); });
            row.addEventListener('dragend', () => { row.classList.remove('dragging'); dragged = null; });
            row.addEventListener('dragover', event => {
                event.preventDefault();
                if (!dragged || dragged === row) return;
                const rect = row.getBoundingClientRect();
                list.insertBefore(dragged, event.clientY < rect.top + rect.height / 2 ? row : row.nextSibling);
            });
        });
    }

    function openNavigationOrderEditor() {
        showAppModal('Orden de mi menú', `<div class="navigation-order-intro"><span>✎</span><p>Este orden es personal para su usuario. No cambia la vista de las demás personas.</p></div>${navigationOrderRows()}`, false);
        initNavigationOrderEditor();
    }

    function openArchivedActivities() {
        const rows = state.archivedActivities || [];
        showAppModal('Actividades archivadas', rows.length ? `<div class="archived-activity-grid">${rows.map(activity => `<article class="archived-activity-card priority-preview-${h(activity.priority)}">${activity.preview_image_id ? `<img data-protected-image data-file-type="activity" data-id="${activity.preview_image_id}" alt="Foto de ${h(activity.title)}">` : '<div class="archived-activity-placeholder">✓</div>'}<div><div class="activity-preview-top">${activity.label_name ? `<span class="activity-label" style="--label-color:${h(activity.label_color || '#64748b')}">${h(activity.label_name)}</span>` : '<span class="activity-label label-empty">Sin etiqueta</span>'}<span class="priority priority-${h(activity.priority)}">${capitalize(activity.priority)}</span></div><h3>${h(activity.title)}</h3><p>${h(activity.hive_name || 'Sin colmena')} · Terminada ${formatDateTime(activity.completed_at)}</p><button class="btn btn-small btn-secondary" type="button" data-command="activity-open" data-id="${activity.id}">Abrir actividad</button></div></article>`).join('')}</div>` : emptyState('✓','No hay actividades archivadas','Las actividades terminadas aparecerán aquí.'));
    }

    function shell({ title, subtitle = '', active = 'dashboard', actions = '', content }) {
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
                        <div class="nav-menu-tools"><span>Mi menú</span><button type="button" data-command="nav-order-open" title="Cambiar orden" aria-label="Cambiar orden del menú">✎</button></div>${orderedNavigationItems().map(([path, icon, label, key]) => `<a class="${active === key ? 'active' : ''}" href="#${path}"><span>${icon}</span> ${label}</a>`).join('')}
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
        queueMicrotask(() => hydrateProtectedImages());
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
                <div class="connection-state connection-ready"><span class="connection-dot"></span><span>Servidor configurado automáticamente</span></div>

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
            actions: '<button class="btn btn-primary" type="button" data-command="activity-open">+ Nueva actividad</button>',
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
                    ${(data.recent_activities || []).length ? `<div class="activity-preview-grid">${data.recent_activities.map(activity => `<button type="button" class="activity-preview-card priority-preview-${h(activity.priority)}" data-command="activity-open" data-id="${activity.id}"><div class="activity-preview-top"><span class="activity-status-chip" style="--activity-status:${h(activity.status_color || '#78906f')}"><i></i>${h(activity.status_name || 'Pendiente')}</span><span class="priority priority-${h(activity.priority)}">${capitalize(activity.priority)}</span></div><h3>${h(activity.title)}</h3><div class="activity-preview-meta"><span>⬡ ${h(activity.hive_name || 'Sin colmena')}</span><time>◷ ${formatDate(activity.due_date)}</time></div>${activity.label_name ? `<span class="activity-label activity-preview-label" style="--label-color:${h(activity.label_color || '#64748b')}">${h(activity.label_name)}</span>` : '<span class="activity-label activity-preview-label label-empty">Sin etiqueta</span>'}<span class="activity-preview-arrow">Abrir →</span></button>`).join('')}</div>` : emptyState('✓', 'No hay actividades abiertas', 'Puede crear la primera desde el botón superior.')}
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
            actions: '<a class="btn btn-secondary hives-technical-button" href="#/technical"><span>⬡</span> Manejo</a><a class="btn btn-primary" href="#/hive-edit">+ Nueva colmena</a>',
            content: `
                <form class="filter-bar" data-form="hive-filter">
                    <label class="search-field"><span>⌕</span><input type="search" name="q" value="${h(q)}" placeholder="Buscar colmena"></label>
                    <select name="status"><option value="">Todos los estados</option><option value="activa" ${status === 'activa' ? 'selected' : ''}>Activa</option><option value="observacion" ${status === 'observacion' ? 'selected' : ''}>En observación</option><option value="inactiva" ${status === 'inactiva' ? 'selected' : ''}>Inactiva</option><option value="baja" ${status === 'baja' ? 'selected' : ''}>Baja</option></select>
                    <button class="btn btn-secondary" type="submit">Filtrar</button><a class="btn btn-ghost" href="#/hives">Limpiar</a>
                </form>
                ${(data.hives || []).length ? `<section class="card-grid">${data.hives.map(hive => `<a class="entity-card hive-visual-card hive-card-clickable" href="#/hive/${hive.id}" aria-label="Abrir ficha de ${h(hive.name)}">
                    <div class="hive-card-cover ${hive.cover_photo_id ? 'has-photo' : ''}">
                        ${hive.cover_photo_id ? `<img class="protected-image" data-protected-image="1" data-file-type="hive" data-id="${hive.cover_photo_id}" alt="${h(hive.name)}">` : '<div class="hive-card-placeholder"><span>⬡</span><small>Sin banner</small></div>'}
                        <span class="badge status-${h(hive.status)}">${capitalize(hive.status)}</span>
                    </div>
                    <div class="hive-card-body"><h2>${h(hive.name)}</h2><div class="entity-meta"><span><b>Creada:</b> ${formatDate(hive.creation_date)}</span><span><b>Reina:</b> ${hive.queen_year ? h(hive.queen_year) : 'Sin indicar'}</span></div><div class="entity-counters"><span><strong>${Number(hive.open_activities || 0)}</strong> actividades</span><span><strong>${Number(hive.notes_count || 0)}</strong> observaciones</span><span><strong>${Number(hive.photos_count || 0)}</strong> archivos</span></div><div class="hive-card-open-hint"><span>Abrir ficha</span><b>→</b></div></div>
                </a>`).join('')}</section>` : `<div class="empty-state panel"><div>▦</div><h3>No hay colmenas</h3><p>Cree la primera ficha para comenzar.</p><a class="btn btn-primary" href="#/hive-edit">Crear colmena</a></div>`}`
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
                ${(() => { const t=data.technical||{}, si=t.season||{}, li=t.last_inspection||{}; return `<section class="hive-technical-strip panel"><div class="hive-technical-title"><span class="eyebrow">MANEJO</span><h2>${h(si.name||'Sin temporada activa')}</h2><p>${li.inspection_date?`Última inspección: ${formatDate(li.inspection_date)}`:'Todavía no hay inspecciones registradas.'}</p></div><div class="hive-technical-metrics"><article><small>Cosecha</small><strong>${Number(t.harvest_kg||0).toLocaleString('es-AR',{maximumFractionDigits:2})} kg</strong></article><article><small>Sanidad</small><strong>${integerQty(t.health_count||0)}</strong></article><article><small>Alimentaciones</small><strong>${integerQty(t.feeding_count||0)}</strong></article></div><div class="hive-technical-actions"><button class="btn btn-small btn-primary" type="button" data-command="apiary-inspection-new" data-hive-id="${hive.id}">+ Inspección</button><button class="btn btn-small btn-secondary" type="button" data-command="apiary-health-new" data-hive-id="${hive.id}">Sanidad</button><button class="btn btn-small btn-secondary" type="button" data-command="apiary-feeding-new" data-hive-id="${hive.id}">Alimentación</button><a class="btn btn-small btn-ghost" href="#/technical?view=performance">Ver rendimiento</a></div>${(t.timeline||[]).length?`<div class="hive-technical-recent"><strong>Historial técnico reciente</strong><div>${(t.timeline||[]).slice(0,5).map(ev=>`<span class="technical-event technical-event-${h(ev.kind)}"><b>${formatDate(ev.event_date)}</b>${h(ev.title)}${ev.detail?`<small>${h(ev.detail)}</small>`:''}</span>`).join('')}</div></div>`:''}</section>`; })()}
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
                    <section class="panel span-2 animated-panel"><div class="panel-header"><div><h2>Actividades abiertas</h2><p>Trabajo pendiente en esta colmena</p></div><button class="btn btn-small btn-primary" type="button" data-command="activity-open" data-hive-id="${hive.id}">+ Actividad</button></div>${openActivities.length ? `<div class="activity-preview-grid hive-activity-preview-grid">${openActivities.map(activity => `<button type="button" class="activity-preview-card priority-preview-${h(activity.priority)}" data-command="activity-open" data-id="${activity.id}"><div class="activity-preview-top"><span class="activity-status-chip" style="--activity-status:${h(activity.status_color || '#78906f')}"><i></i>${h(activity.status_name || 'Pendiente')}</span><span class="priority priority-${h(activity.priority)}">${capitalize(activity.priority)}</span></div><h3>${h(activity.title)}</h3><div class="activity-preview-meta"><span>Colmena: ${h(hive.name)}</span><time>◷ ${formatDate(activity.due_date)}</time></div>${activity.label_name ? `<span class="activity-label activity-preview-label" style="--label-color:${h(activity.label_color || '#64748b')}">${h(activity.label_name)}</span>` : '<span class="activity-label activity-preview-label label-empty">Sin etiqueta</span>'}<span class="activity-preview-arrow">Ver actividad →</span></button>`).join('')}</div>` : '<p class="muted empty-line">No hay actividades abiertas.</p>'}</section>
                    <section class="panel animated-panel"><div class="panel-header"><div><h2>Historial</h2><p>Actividades terminadas</p></div></div>${historyActivities.length ? `<div class="history-list">${historyActivities.map(activity => `<button type="button" class="history-activity-button" data-command="activity-open" data-id="${activity.id}"><strong>${h(activity.title)}</strong><small>${formatDateTime(activity.completed_at)}</small></button>`).join('')}</div>` : '<p class="muted empty-line">Todavía no hay actividades terminadas.</p>'}</section>
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

    function materialCategoryIcon(name='') {
        const n=String(name).toLowerCase();
        if(n.includes('cuadro')||n.includes('marco')) return '▤';
        if(n.includes('alza')||n.includes('caja')) return '▣';
        if(n.includes('techo')||n.includes('piso')||n.includes('tapa')) return '⌂';
        if(n.includes('núcleo')||n.includes('nucleo')) return '⬡';
        if(n.includes('aliment')) return '◒';
        if(n.includes('indument')) return '♢';
        if(n.includes('sanidad')||n.includes('tratamiento')) return '✚';
        if(n.includes('herramient')) return '⌁';
        return '◆';
    }

    function materialPhoto(material, className='material-card-photo') {
        return material?.photo_relative_path
            ? `<img class="${className}" data-protected-image data-file-type="material" data-id="${material.id}" alt="${h(material.name)}">`
            : `<div class="${className} material-photo-placeholder"><span>${materialCategoryIcon(material?.category)}</span><small>Sin foto</small></div>`;
    }

    function openMaterialCategories() {
        const rows=state.materialCategories||[];
        showAppModal('Categorías de materiales', `<div class="material-category-manager"><form class="material-category-create" data-form="material-category-save"><label class="field"><span>Nueva categoría</span><input name="name" maxlength="100" required placeholder="Ej.: Ahumadores"></label><button class="btn btn-primary" type="submit">Agregar</button></form><div class="material-category-manager-list">${rows.map(c=>`<article><form data-form="material-category-save"><input type="hidden" name="id" value="${c.id}"><input name="name" maxlength="100" required value="${h(c.category)}"><button class="icon-button" type="submit" title="Guardar">✓</button></form><span>${Number(c.total||0)} materiales</span>${String(c.category).toLowerCase()==='otros materiales'?'':`<button class="icon-button danger" type="button" data-command="material-category-delete" data-id="${c.id}" title="Eliminar">×</button>`}</article>`).join('')}</div></div>`, false);
    }

    async function renderMaterials(params) {
        loading('Cargando materiales…');
        const status=params.get('status')||'',category=params.get('category')||'',q=params.get('q')||'',edit=Number(params.get('edit')||0);
        const view=params.get('view')||((status||q||edit)?'list':category?'cards':'categories');
        const data=await api('materials',{params:{status,category,q}});
        state.materialCategories=data.categories||[];
        const editing=edit?((data.materials||[]).find(x=>Number(x.id)===edit)||((await api('materials')).materials||[]).find(x=>Number(x.id)===edit)):null;
        const counts=data.counts||{},categories=data.categories||[],allMaterials=data.materials||[];
        const listUrl=values=>`#/materials?${new URLSearchParams({view:'list',...values}).toString()}`;
        const cardsUrl=cat=>`#/materials?${new URLSearchParams({view:'cards',category:cat}).toString()}`;
        const pill=(value,label,count)=>`<a class="material-state-card ${status===value&&view==='list'?'active':''}" href="${listUrl(value?{status:value}:{})}"><span>${value==='en_uso'?'↗':value==='reparacion'?'⌁':value==='disponible'?'✓':'◆'}</span><div><strong>${integerQty(count)}</strong><small>${label}</small></div></a>`;
        const summary=`<section class="material-state-grid">${pill('','Todos los materiales',counts.total)}${pill('disponible','Disponibles',counts.available)}${pill('en_uso','En uso',counts.in_use)}${pill('reparacion','En reparación',counts.repair)}</section>`;
        const categoryCards=categories.length?`<div class="material-category-grid">${categories.map(c=>{const preview=allMaterials.find(m=>m.category===c.category&&m.photo_relative_path)||allMaterials.find(m=>m.category===c.category);return `<a class="material-category-card material-category-card-photo" href="${cardsUrl(c.category)}">${preview?materialPhoto(preview,'material-category-cover'):`<div class="material-category-cover material-photo-placeholder"><span>${materialCategoryIcon(c.category)}</span></div>`}<div class="material-category-overlay"></div><div class="material-category-card-content"><div class="material-category-title"><h3>${h(c.category)}</h3><strong>${integerQty(c.total)}</strong></div><div class="material-category-counts"><span><b>${integerQty(c.available)}</b> disponibles</span><span><b>${integerQty(c.in_use)}</b> en uso</span><span><b>${integerQty(c.repair)}</b> reparación</span></div><span class="material-category-arrow">Abrir categoría →</span></div></a>`}).join('')}</div>`:emptyState('◆','No hay categorías','Cree la primera categoría y luego agregue materiales.');
        if(view==='categories'){
            shell({title:'Materiales',subtitle:'Categorías elegidas por usted y materiales identificados con fotografía',active:'materials',actions:'<button class="btn btn-secondary" type="button" data-command="material-categories-open">Administrar categorías</button><a class="btn btn-secondary" href="#/materials?view=list">Ver lista completa</a><a class="btn btn-primary" href="#/materials?view=list">+ Agregar material</a>',content:`${summary}<section class="panel material-categories-panel"><div class="panel-header"><div><h2>Mis categorías</h2><p>Puede crear, renombrar y organizar los materiales como prefiera.</p></div></div>${categoryCards}</section>`});hydrateProtectedImages();return;
        }
        const categoryOptions=categories.map(c=>`<option value="${h(c.category)}" ${String(editing?.category||category||'Otros materiales')===String(c.category)?'selected':''}>${h(c.category)}</option>`).join('');
        const materialForm=`<section class="panel sticky-panel material-editor-panel"><div class="panel-header"><div><h2>${editing?'Editar material':'Agregar material'}</h2><p>Foto, categoría, estado y ubicación</p></div></div><form data-form="material-save" data-material-form enctype="multipart/form-data"><input type="hidden" name="id" value="${editing?.id||''}"><label class="field"><span>Nombre *</span><input name="name" required maxlength="160" value="${h(editing?.name||'')}" placeholder="Ej.: Ahumador grande"></label><label class="field"><span>Categoría *</span><select name="category" required>${categoryOptions}</select></label><button class="btn btn-small btn-ghost material-manage-inline" type="button" data-command="material-categories-open">✎ Administrar categorías</button><label class="field"><span>${editing?.photo_relative_path?'Reemplazar foto':'Foto del material'}</span><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>${editing?.photo_relative_path?`<div class="material-current-photo">${materialPhoto(editing)}<label class="checkbox-field"><input type="checkbox" name="remove_photo" value="1"><span>Quitar foto actual</span></label></div>`:''}<label class="field"><span>Estado</span><select name="status" data-material-status>${[['disponible','Disponible'],['en_uso','En uso'],['reparacion','En reparación']].map(([v,l])=>`<option value="${v}" ${(editing?.status||'disponible')===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="field" data-hive-field><span>Colmena</span><select name="hive_id"><option value="">Seleccione</option>${(data.hives||[]).map(x=>`<option value="${x.id}" ${Number(editing?.hive_id||0)===Number(x.id)?'selected':''}>${h(x.name)}</option>`).join('')}</select></label><label class="field"><span>Notas</span><textarea name="notes" rows="3">${h(editing?.notes||'')}</textarea></label><div class="form-actions"><button class="btn btn-primary" type="submit">${editing?'Guardar cambios':'+ Agregar material'}</button>${editing?'<a class="btn btn-ghost" href="#/materials?view=list">Cancelar</a>':''}</div></form></section>`;
        const cards=allMaterials.length?`<div class="material-visual-grid">${allMaterials.map(m=>`<article class="material-visual-card">${materialPhoto(m)}<div class="material-visual-card-body"><div class="material-visual-head"><span class="material-category-chip">${materialCategoryIcon(m.category)} ${h(m.category)}</span><span class="badge material-${h(m.status)}">${{disponible:'Disponible',en_uso:'En uso',reparacion:'En reparación'}[m.status]}</span></div><h3>${h(m.name)}</h3><p>${h(m.notes||'Sin observaciones')}</p><small>${m.hive_name?`Colmena: ${h(m.hive_name)}`:'Sin colmena asignada'}</small><div class="entity-actions"><a class="btn btn-small btn-secondary" href="#/materials?${new URLSearchParams({view:'cards',category:m.category,edit:m.id}).toString()}">Editar</a><button class="icon-button danger" data-command="material-delete" data-id="${m.id}">×</button></div></div></article>`).join('')}</div>`:emptyState('⬡','No hay materiales','Agregue el primer material dentro de esta categoría.');
        const table=allMaterials.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Foto</th><th>Material</th><th>Categoría</th><th>Estado</th><th>Colmena</th><th>Notas</th><th></th></tr></thead><tbody>${allMaterials.map(m=>`<tr><td><div class="material-table-photo">${materialPhoto(m,'material-table-photo-inner')}</div></td><td><strong>${h(m.name)}</strong></td><td><span class="material-category-chip">${materialCategoryIcon(m.category)} ${h(m.category)}</span></td><td><span class="badge material-${h(m.status)}">${{disponible:'Disponible',en_uso:'En uso',reparacion:'En reparación'}[m.status]}</span></td><td>${h(m.hive_name||'—')}</td><td class="cell-notes">${h(m.notes||'—')}</td><td class="row-actions"><a class="icon-button" href="#/materials?${new URLSearchParams({view:'list',...(status?{status}:{}),...(category?{category}:{}),...(q?{q}:{}),edit:m.id}).toString()}">✎</a><button class="icon-button danger" data-command="material-delete" data-id="${m.id}">×</button></td></tr>`).join('')}</tbody></table></div>`:emptyState('⬡','No hay materiales','No hay resultados para los filtros seleccionados.');
        const listing=view==='cards'?`<section class="panel material-card-list-panel"><div class="panel-header"><div><h2>${h(category||'Todos los materiales')}</h2><p>Vista visual por tarjetas</p></div><a class="btn btn-small btn-secondary" href="${listUrl(category?{category}:{})}">Ver como lista</a></div>${cards}</section>`:`<section class="panel"><form class="filter-bar material-list-filter" data-form="material-filter"><input type="hidden" name="view" value="list"><label class="search-field"><span>⌕</span><input type="search" name="q" value="${h(q)}" placeholder="Buscar material, categoría o colmena"></label><label class="field compact-field"><span>Categoría</span><select name="category"><option value="">Todas</option>${categories.map(c=>`<option value="${h(c.category)}" ${category===c.category?'selected':''}>${h(c.category)}</option>`).join('')}</select></label><label class="field compact-field"><span>Estado</span><select name="status"><option value="">Todos</option>${[['disponible','Disponible'],['en_uso','En uso'],['reparacion','En reparación']].map(([v,l])=>`<option value="${v}" ${status===v?'selected':''}>${l}</option>`).join('')}</select></label><button class="btn btn-secondary">Aplicar</button></form>${table}</section>`;
        shell({title:category?`Materiales · ${category}`:'Materiales',subtitle:view==='cards'?'Vista visual con fotos':'Vista completa por lista',active:'materials',actions:'<a class="btn btn-secondary" href="#/materials">Ver categorías</a><button class="btn btn-secondary" type="button" data-command="material-categories-open">Administrar categorías</button>',content:`${summary}<div class="split-layout material-modern-layout">${materialForm}${listing}</div>`});updateMaterialForm();hydrateProtectedImages();
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

    function closeAppModal() { document.querySelector('.modal-backdrop')?.remove(); }

    function showAppModal(title, body, wide = true) {
        closeAppModal();
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.innerHTML = `<section class="app-modal ${wide ? 'app-modal-wide' : ''}" role="dialog" aria-modal="true"><header><div><small>Gestión Apícola</small><h2>${h(title)}</h2></div><button class="modal-close" type="button" data-command="modal-close">×</button></header><div class="app-modal-body">${body}</div></section>`;
        document.body.appendChild(backdrop);
        requestAnimationFrame(() => backdrop.classList.add('open'));
        hydrateProtectedImages();
    }

    async function openActivityModal(id = 0, defaults = {}) {
        const data = await api('activity', { params: { id } });
        const item = data.activity;
        const selectedHive = item?.hive_id || defaults.hiveId || '';
        showAppModal(item ? 'Editar actividad' : 'Nueva actividad', `<div class="modal-form-layout"><form data-form="activity-save" enctype="multipart/form-data"><input type="hidden" name="id" value="${item?.id || ''}"><label class="field"><span>Título *</span><input name="title" maxlength="180" required value="${h(item?.title || '')}"></label><label class="field"><span>Descripción</span><textarea name="description" rows="4">${h(item?.description || '')}</textarea></label><div class="form-grid two-columns"><label class="field"><span>Colmena</span><select name="hive_id"><option value="">Sin colmena</option>${(data.hives || []).map(x => `<option value="${x.id}" ${String(x.id) === String(selectedHive) ? 'selected' : ''}>${h(x.name)}</option>`).join('')}</select></label><label class="field"><span>Responsable</span><input name="responsible" value="${h(item?.responsible || '')}" placeholder="Chiara o Felipe"></label><label class="field"><span>Estado</span><select name="status_id">${(data.statuses || []).map(x => `<option value="${x.id}" ${Number(item?.status_id || 1) === Number(x.id) ? 'selected' : ''}>${h(x.name)}</option>`).join('')}</select></label><label class="field"><span>Etiqueta</span><select name="label_id"><option value="">Sin etiqueta</option>${(data.labels || []).map(x => `<option value="${x.id}" ${Number(item?.label_id || 0) === Number(x.id) ? 'selected' : ''}>${h(x.name)}</option>`).join('')}</select></label><label class="field"><span>Prioridad</span><select name="priority">${['baja','normal','alta','urgente'].map(x => `<option value="${x}" ${(item?.priority || 'normal') === x ? 'selected' : ''}>${capitalize(x)}</option>`).join('')}</select></label><label class="field"><span>Fecha prevista</span><input type="date" name="due_date" value="${h(item?.due_date || '')}"></label></div>${item ? '' : '<label class="field"><span>Foto o archivo inicial</span><input type="file" name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf"></label>'}<div class="form-actions"><button class="btn btn-primary" type="submit">Guardar actividad</button><button class="btn btn-ghost" type="button" data-command="modal-close">Cancelar</button>${item ? `<button class="btn btn-danger" type="button" data-command="activity-delete" data-id="${item.id}">Eliminar</button>` : ''}</div></form>${item ? `<aside class="modal-side-panel"><h3>Fotos y archivos</h3><form data-form="activity-attachment-upload" enctype="multipart/form-data"><input type="hidden" name="activity_id" value="${item.id}"><input type="file" name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf" required><button class="btn btn-secondary btn-small">Agregar</button></form><div class="modal-attachment-grid">${(data.attachments || []).map(f => `<article>${String(f.mime_type).startsWith('image/') ? `<img data-protected-image data-file-type="activity" data-id="${f.id}" alt="${h(f.original_name)}">` : '<div class="pdf-preview">PDF</div>'}<button class="file-link file-button" data-command="open-file" data-file-type="activity" data-id="${f.id}" data-name="${h(f.original_name)}">${h(f.original_name)}</button><button class="icon-button danger" data-command="activity-attachment-delete" data-id="${f.id}" data-activity-id="${item.id}">×</button></article>`).join('')}</div><h3>Historial</h3><div class="history-list">${(data.logs || []).map(x => `<div><strong>${h(x.action)}</strong><small>${formatDateTime(x.created_at)}</small></div>`).join('')}</div></aside>` : ''}</div>`);
    }

    async function googleCalendarStatus(appCode) {
        try { return await api('google_calendar_status', { params: { app_code: appCode } }); }
        catch (_) { return { configured:false, connected:false, email:'' }; }
    }

    async function syncGoogleBestEffort(appCode) {
        try { await api('google_calendar_sync', { method:'POST', data:{ app_code:appCode } }); } catch (_) {}
    }

    function googleCalendarButton(status) {
        return `<button class="btn btn-secondary google-calendar-button ${status.connected?'is-connected':''}" type="button" data-command="google-calendar-open"><span>G</span>${status.connected?'Google conectado':'Vincular Google Calendar'}</button>`;
    }

    async function openGoogleCalendarModal(appCode='apicultura') {
        const status=await googleCalendarStatus(appCode);
        if(!status.configured){
            showAppModal('Google Calendar',`<section class="google-calendar-empty"><div class="google-logo">G</div><h3>Falta configurar Google</h3><p>Las credenciales OAuth todavía no están cargadas en el servidor. Una vez configuradas, cada usuario podrá conectar su cuenta desde este mismo botón.</p></section>`,false);return;
        }
        if(!status.connected){
            showAppModal('Vincular Google Calendar',`<section class="google-calendar-connect"><div class="google-logo">G</div><p>Los eventos y actividades de esta aplicación se copiarán a su Google Calendar.</p><form data-form="google-calendar-connect"><input type="hidden" name="app_code" value="${appCode}">${status.email?`<input type="hidden" name="email" value="${h(status.email)}"><div class="google-known-email"><small>Cuenta registrada</small><strong>${h(status.email)}</strong></div>`:`<label class="field"><span>Correo de Google</span><input type="email" name="email" required placeholder="nombre@gmail.com"></label>`}<button class="btn btn-primary">Continuar con Google</button></form></section>`,false);return;
        }
        const c=status.connection||{};
        showAppModal('Google Calendar conectado',`<section class="google-calendar-connected"><div class="google-connection-head"><div class="google-logo">G</div><div><strong>${h(c.google_email||status.email||'Cuenta conectada')}</strong><small>${c.last_sync_at?`Última sincronización: ${formatDateTime(c.last_sync_at)}`:'Todavía no se sincronizó'}</small>${c.last_sync_error?`<span class="google-sync-error">${h(c.last_sync_error)}</span>`:''}</div></div><form data-form="google-calendar-settings"><input type="hidden" name="app_code" value="${appCode}"><div class="form-grid two-columns"><label class="field"><span>Aviso por correo</span><select name="email_reminder_minutes">${[[0,'Sin correo'],[120,'2 horas antes'],[1440,'1 día antes'],[2880,'2 días antes'],[10080,'1 semana antes']].map(([v,l])=>`<option value="${v}" ${Number(c.email_reminder_minutes)===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="field"><span>Aviso en Calendar</span><select name="popup_reminder_minutes">${[[0,'Sin aviso'],[30,'30 minutos antes'],[120,'2 horas antes'],[1440,'1 día antes']].map(([v,l])=>`<option value="${v}" ${Number(c.popup_reminder_minutes)===v?'selected':''}>${l}</option>`).join('')}</select></label></div><button class="btn btn-primary">Guardar avisos</button></form><div class="form-actions"><button class="btn btn-secondary" data-command="google-calendar-sync" data-app="${appCode}">Sincronizar ahora</button><button class="btn btn-ghost" data-command="google-calendar-disconnect" data-app="${appCode}">Desconectar</button></div></section>`,false);
    }

    function calendarMonthRange(offset = 0) {
        const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + Number(offset || 0));
        const year = base.getFullYear(), month = base.getMonth();
        const from = `${year}-${String(month + 1).padStart(2,'0')}-01`;
        const last = new Date(year, month + 1, 0).getDate();
        return { base, from, to: `${year}-${String(month + 1).padStart(2,'0')}-${String(last).padStart(2,'0')}`, last, offset: Number(offset || 0) };
    }

    async function renderCalendar(params) {
        loading('Cargando calendario…');
        const range = calendarMonthRange(params.get('offset') || 0);
        const [data,googleStatus] = await Promise.all([
            api('calendar_events', { params: { app_code:'apicultura', from:range.from, to:range.to } }),
            googleCalendarStatus('apicultura')
        ]);
        const firstDay = new Date(`${range.from}T12:00:00`).getDay();
        const byDate = {};
        (data.events || []).forEach(x => { (byDate[x.start_date] ||= []).push({...x, kind:'manual'}); });
        (data.activities || []).forEach(x => { (byDate[x.start_date] ||= []).push({...x, kind:'activity'}); });
        const cells = [];
        for (let i=0;i<firstDay;i++) cells.push('<div class="calendar-day outside"></div>');
        for (let day=1;day<=range.last;day++) {
            const date=`${range.from.slice(0,8)}${String(day).padStart(2,'0')}`,items=byDate[date]||[],isToday=date===today();
            cells.push(`<div class="calendar-day ${isToday?'is-today':''}"><button class="calendar-day-hit" type="button" data-command="calendar-new" data-date="${date}" aria-label="Agregar evento el ${date}"></button><div class="calendar-day-number"><span>${day}</span><button type="button" data-command="calendar-new" data-date="${date}">+</button></div><div class="calendar-day-events">${items.map(x=>x.kind==='activity'?`<a class="calendar-event activity" href="#/activities"><strong>${h(x.title)}</strong><small>${h(x.entity_name||'Actividad')}</small></a>`:`<button class="calendar-event manual" style="--event-color:${h(x.color||'#a69b24')}" data-command="calendar-edit" data-id="${x.id}" data-title="${h(x.title)}" data-type="${h(x.event_type)}" data-start="${h(x.start_date)}" data-end="${h(x.end_date||'')}" data-notes="${h(x.notes||'')}"><strong>${h(x.title)}</strong><small>${capitalize(x.event_type)}</small></button>`).join('')}</div></div>`);
        }
        const label=new Intl.DateTimeFormat('es-AR',{month:'long',year:'numeric'}).format(range.base),eventCount=(data.events||[]).length,activityCount=(data.activities||[]).length;
        shell({title:'Calendario',subtitle:'Actividades y fechas apícolas importantes',active:'calendar',actions:`${googleCalendarButton(googleStatus)}<button class="btn btn-primary" data-command="calendar-new">+ Nuevo evento</button>`,content:`<section class="calendar-shell"><section class="calendar-toolbar panel"><a class="calendar-nav" href="#/calendar?offset=${range.offset-1}" aria-label="Mes anterior">←</a><div class="calendar-month-title"><small>${eventCount} eventos · ${activityCount} actividades</small><h2>${capitalize(label)}</h2></div><a class="calendar-today" href="#/calendar?offset=0">Hoy</a><a class="calendar-nav" href="#/calendar?offset=${range.offset+1}" aria-label="Mes siguiente">→</a></section><section class="calendar-grid"><div class="calendar-weekday">Dom</div><div class="calendar-weekday">Lun</div><div class="calendar-weekday">Mar</div><div class="calendar-weekday">Mié</div><div class="calendar-weekday">Jue</div><div class="calendar-weekday">Vie</div><div class="calendar-weekday">Sáb</div>${cells.join('')}</section></section>`});
    }

    function openCalendarModal(data = {}) {
        showAppModal(data.id ? 'Editar evento' : 'Nuevo evento', `<form data-form="calendar-save"><input type="hidden" name="id" value="${data.id || ''}"><input type="hidden" name="app_code" value="apicultura"><label class="field"><span>Título</span><input name="title" required value="${h(data.title || '')}"></label><label class="field"><span>Tipo</span><select name="event_type">${[['general','General'],['armado_pedido','Armado de pedido'],['zanganos','Arranque de zánganos'],['mielada','Mielada'],['senasa','Calendario SENASA'],['floracion','Floración'],['reunion','Reunión']].map(([v,l])=>`<option value="${v}" ${data.type===v?'selected':''}>${l}</option>`).join('')}</select></label><div class="form-grid two-columns"><label class="field"><span>Desde</span><input type="date" name="start_date" required value="${data.start || today()}"></label><label class="field"><span>Hasta</span><input type="date" name="end_date" value="${data.end || ''}"></label></div><label class="field"><span>Notas</span><textarea name="notes">${h(data.notes || '')}</textarea></label><input type="hidden" name="color" value="#a69b24"><div class="form-actions"><button class="btn btn-primary">Guardar</button>${data.id ? `<button type="button" class="btn btn-danger" data-command="calendar-delete" data-id="${data.id}">Eliminar</button>` : ''}</div></form>`, false);
    }


    const laRudaStatusLabel = value => ({ingresado:'Ingresado',produccion:'En preparación',listo:'Listo para entregar',entregado:'Entregado',cancelado:'Cancelado'}[value] || capitalize(value));
    const integerQty = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0));
    const gramsLabel = value => `${integerQty(value)} g`;

    function productPhoto(product, className = 'la-ruda-product-photo') {
        return product?.photo_relative_path
            ? `<img class="${className}" data-protected-image data-file-type="la_ruda_product" data-id="${product.id}" alt="${h(product.name)}">`
            : `<div class="${className} la-ruda-photo-placeholder"><span>◆</span><small>Sin foto</small></div>`;
    }

    function openLaRudaOrderForm(order = {}) {
        showAppModal(order.id ? 'Editar pedido' : 'Nuevo pedido', `<form data-form="la-ruda-order-save"><input type="hidden" name="id" value="${order.id||''}"><div class="form-grid two-columns"><label class="field"><span>Cliente *</span><input name="customer_name" required value="${h(order.customer_name||'')}"></label><label class="field"><span>Contacto</span><input name="customer_contact" value="${h(order.customer_contact||'')}"></label><label class="field"><span>Fecha del pedido</span><input type="date" name="order_date" required value="${order.order_date||today()}"></label><label class="field"><span>Fecha estimada de entrega</span><input type="date" name="due_date" value="${order.due_date||''}"></label><label class="field full"><span>Observaciones</span><textarea name="notes" rows="4">${h(order.notes||'')}</textarea></label></div><div class="calendar-auto-note"><span>▣</span><div><strong>Recordatorio automático</strong><small>Al guardar se crea en el calendario un control de armado para 3 días después de la fecha del pedido.</small></div></div><div class="form-actions"><button class="btn btn-primary">Guardar y abrir pedido</button></div></form>`, false);
    }

    async function openLaRudaOrder(id) {
        const data=await api('la_ruda_order',{params:{id}}),order=data.order,products=state.laRudaData?.products||[];
        const items=order.items||[];
        showAppModal(`Pedido #${order.id} · ${order.customer_name}`, `<div class="la-ruda-order-head"><div><span class="la-ruda-status status-${h(order.status)}">${h(laRudaStatusLabel(order.status))}</span><h3>${h(order.customer_name)}</h3><p>${formatDate(order.order_date)}${order.due_date?` · Entrega ${formatDate(order.due_date)}`:''}${order.customer_contact?` · ${h(order.customer_contact)}`:''}</p></div><button class="btn btn-small btn-secondary" data-command="la-ruda-order-edit" data-id="${order.id}">Editar datos</button></div>${order.notes?`<p class="la-ruda-order-notes">${nl2br(order.notes)}</p>`:''}
        <div class="la-ruda-status-actions">${['ingresado','produccion','listo','entregado'].map(st=>`<button type="button" class="${order.status===st?'active':''}" data-command="la-ruda-order-status" data-id="${order.id}" data-status="${st}">${h(laRudaStatusLabel(st))}</button>`).join('')}</div>
        <section class="la-ruda-order-items"><div class="panel-header"><div><h3>Productos del pedido</h3><p>Las etapas permiten seguir la preparación sin perder el historial.</p></div></div>${items.length?items.map(item=>{const pct=Number(item.stage_count)?Math.round(Number(item.completed_count)*100/Number(item.stage_count)):0;return `<article class="la-ruda-order-item"><header><div><span class="product-line">${h(item.category_name||'Producto')}</span><h3>${integerQty(item.quantity)} ${h(item.unit)} · ${h(item.product_name)}</h3>${item.notes?`<p>${h(item.notes)}</p>`:''}</div><div class="production-progress"><strong>${pct}%</strong><span><i style="width:${pct}%"></i></span></div></header><div class="production-stage-list">${(item.stages||[]).map(stage=>`<button type="button" class="production-stage ${Number(stage.completed)?'done':''}" data-command="la-ruda-stage-toggle" data-id="${stage.id}" data-order-id="${order.id}" data-completed="${Number(stage.completed)?0:1}"><span>${Number(stage.completed)?'✓':'○'}</span><div><strong>${h(stage.name)}</strong>${stage.completed_at?`<small>${formatDateTime(stage.completed_at)}${stage.completed_by_name?` · ${h(stage.completed_by_name)}`:''}</small>`:''}</div></button>`).join('')}</div><button class="icon-button danger la-ruda-item-delete" type="button" data-command="la-ruda-item-delete" data-id="${item.id}" data-order-id="${order.id}" title="Quitar producto">×</button></article>`}).join(''):'<p class="muted">Todavía no hay productos en este pedido.</p>'}</section>
        <form class="la-ruda-add-item" data-form="la-ruda-item-save"><input type="hidden" name="order_id" value="${order.id}"><label class="field"><span>Producto</span><select name="product_id" required><option value="">Seleccionar</option>${products.map(p=>`<option value="${p.id}">${h(p.name)} · stock ${integerQty(p.stock_quantity)}</option>`).join('')}</select></label><label class="field"><span>Cantidad</span><input type="number" name="quantity" min="1" step="1" value="1" required></label><label class="field"><span>Precio unitario</span><input type="number" name="unit_price" min="0" step="0.01" value="0"></label><label class="field grow"><span>Detalle</span><input name="notes" placeholder="Opcional"></label><button class="btn btn-primary">Agregar</button></form>
        <div class="form-actions"><button type="button" class="btn btn-danger" data-command="la-ruda-order-delete" data-id="${order.id}">Eliminar pedido</button></div>`, true);
    }

    function openLaRudaStock(product) {
        showAppModal(`Ajustar stock · ${product.name}`, `<div class="stock-current"><small>Stock actual</small><strong>${integerQty(product.stock_quantity)} unidades</strong><span>Valor de materiales: ${moneyARS(product.stock_value_ars)} · ${moneyUSD(product.stock_value_usd)}</span></div><form data-form="la-ruda-stock-adjust"><input type="hidden" name="product_id" value="${product.id}"><label class="field"><span>Fecha</span><input type="date" name="movement_date" value="${today()}" required></label><label class="field"><span>Unidades a sumar o restar</span><input type="number" name="quantity_change" step="1" placeholder="Ej.: 20 o -3" required><small>Los productos se cuentan como unidades enteras.</small></label><label class="field"><span>Valor total del material ingresado</span><input type="number" name="value_change_ars" min="0" step="0.01" value="0"><small>Solo corresponde si está sumando stock fuera de una fabricación.</small></label><label class="field"><span>Cotización del dólar</span><input type="number" name="usd_rate" min="0" step="0.01" value="0"></label><label class="field"><span>Motivo</span><textarea name="notes" rows="3"></textarea></label><button class="btn btn-primary">Actualizar stock</button></form>`, false);
    }

    function openLaRudaProductForm(product = {}) {
        const stages=(product.stages||[]).map(x=>x.name).join('\n');
        showAppModal(product.id?'Editar producto':'Nuevo producto', `<form data-form="la-ruda-product-save" enctype="multipart/form-data"><input type="hidden" name="id" value="${product.id||''}"><div class="product-form-photo">${product.id?productPhoto(product,'product-form-preview'):'<div class="product-form-preview la-ruda-photo-placeholder"><span>◆</span><small>Nueva foto</small></div>'}<label class="field"><span>Fotografía</span><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"><small>${product.photo_original_name?`Actual: ${h(product.photo_original_name)}`:'JPG, PNG o WEBP.'}</small></label></div><div class="form-grid two-columns"><label class="field full"><span>Nombre *</span><input name="name" required value="${h(product.name||'')}"></label><label class="field"><span>Categoría o familia</span><input name="category_name" value="${h(product.category_name||'')}" placeholder="Ej.: Jaulas, Núcleos, Colmenas"></label><label class="field"><span>Gramos por unidad *</span><input type="number" name="grams_per_unit" min="1" step="1" required value="${h(product.grams_per_unit||'')}"></label><label class="field full"><span>Etapas de fabricación, una por línea</span><textarea name="stages" rows="6" placeholder="Impresión 3D\nArmado\nControl final">${h(stages)}</textarea></label><label class="field full"><span>Notas</span><textarea name="notes">${h(product.notes||'')}</textarea></label></div><button class="btn btn-primary">${product.id?'Guardar cambios':'Crear producto'}</button></form>`, false);
    }

    function openLaRudaProductionForm(productId = '') {
        const products=state.laRudaData?.products||[];
        showAppModal('Iniciar fabricación', `<form data-form="la-ruda-production-save" data-production-form><div class="form-grid two-columns"><label class="field full"><span>Producto *</span><select name="product_id" required><option value="">Seleccionar</option>${products.map(p=>`<option value="${p.id}" data-grams="${Number(p.grams_per_unit||0)}" ${String(productId)===String(p.id)?'selected':''}>${h(p.name)} · ${integerQty(p.grams_per_unit)} g/unidad</option>`).join('')}</select></label><label class="field"><span>Cantidad fabricándose *</span><input type="number" name="quantity" min="1" step="1" value="1" required></label><label class="field"><span>Fecha</span><input type="date" name="production_date" value="${today()}" required></label><label class="field"><span>Precio del material por kilo *</span><input type="number" name="material_price_per_kg_ars" min="0.01" step="0.01" required placeholder="Precio en pesos"></label><label class="field"><span>Cotización del dólar *</span><input type="number" name="usd_rate" min="0.01" step="0.01" required></label><label class="field full"><span>Notas</span><textarea name="notes"></textarea></label></div><section class="production-cost-preview"><div><small>Material utilizado</small><strong data-production-grams>0 g</strong></div><div><small>Costo de la fabricación</small><strong data-production-cost>${moneyARS(0)}</strong><span data-production-cost-usd>${moneyUSD(0)}</span></div></section><button class="btn btn-primary">Iniciar fabricación</button></form>`, false);
        updateProductionPreview();
    }

    function updateProductionPreview() {
        const form=document.querySelector('[data-production-form]');if(!form)return;
        const option=form.elements.product_id?.selectedOptions?.[0];const grams=Number(option?.dataset.grams||0);const qty=Math.max(0,Number(form.elements.quantity?.value||0));const price=Math.max(0,Number(form.elements.material_price_per_kg_ars?.value||0));const rate=Math.max(0,Number(form.elements.usd_rate?.value||0));const totalGrams=Math.round(grams*qty);const cost=(totalGrams/1000)*price;
        form.querySelector('[data-production-grams]').textContent=gramsLabel(totalGrams);form.querySelector('[data-production-cost]').textContent=moneyARS(cost);form.querySelector('[data-production-cost-usd]').textContent=moneyUSD(rate?cost/rate:0);
    }

    function openLaRudaPublish(product) {
        showAppModal(`Artículo publicado · ${product.name}`, `<form data-form="la-ruda-publish-save"><input type="hidden" name="id" value="${product.id}"><label class="field"><span>Precio de venta por unidad</span><input type="number" name="sale_price_ars" min="0" step="0.01" value="${h(product.sale_price_ars||'')}" required></label><label class="check-field"><input type="checkbox" name="published_active" value="1" ${Number(product.published_active)?'checked':''}><span>Mostrar en Artículos publicados</span></label><button class="btn btn-primary">Guardar publicación</button></form>`, false);
    }

    function updateLaRudaSaleSplit() {
        const form=document.querySelector('[data-form="la-ruda-sale-save"]');if(!form)return;
        const qty=Math.max(1,Number(form.elements.quantity.value||1));
        const unit=Math.max(0,Number(form.elements.unit_sale_price_ars.value||0));
        const avg=Math.max(0,Number(form.dataset.averageCost||0));
        const total=qty*unit,recovery=Math.min(total,qty*avg),profit=Math.max(0,total-recovery);
        const chiara=form.elements.chiara_profit_ars,felipe=form.elements.felipe_profit_ars;
        const previousProfit=Number(form.dataset.lastProfit||-1);
        if(previousProfit<0 || Math.abs((Number(chiara.value||0)+Number(felipe.value||0))-previousProfit)<0.02){
            const half=Math.round(profit*50)/100;chiara.value=half.toFixed(2);felipe.value=(profit-half).toFixed(2);
        }
        form.dataset.lastProfit=String(profit);
        const chiaraValue=Math.max(0,Number(chiara.value||0)),felipeValue=Math.max(0,Number(felipe.value||0));
        const remaining=profit-chiaraValue-felipeValue;
        form.querySelector('[data-sale-total]').textContent=moneyARS(total);
        form.querySelector('[data-sale-recovery]').textContent=moneyARS(recovery);
        form.querySelector('[data-sale-profit]').textContent=moneyARS(profit);
        form.querySelector('[data-sale-remaining]').textContent=moneyARS(remaining);
        form.querySelector('[data-sale-remaining-box]').classList.toggle('is-balanced',Math.abs(remaining)<0.02);form.querySelector('[data-sale-remaining-box]').classList.toggle('has-error',Math.abs(remaining)>=0.02);
        form.querySelector('button[type="submit"]').disabled=Math.abs(remaining)>=0.02||total<recovery||total<=0;
    }

    function openLaRudaSale(product) {
        const avg=Number(product.average_cost_ars||0);
        showAppModal(`Registrar venta · ${product.name}`, `<section class="sale-product-resume">${productPhoto(product,'sale-product-photo')}<div><small>Stock disponible</small><strong>${integerQty(product.stock_quantity)} unidades</strong><span>Costo promedio: ${moneyARS(avg)} por unidad</span></div></section><form data-form="la-ruda-sale-save" data-average-cost="${avg}"><input type="hidden" name="product_id" value="${product.id}"><div class="form-grid two-columns"><label class="field"><span>Fecha</span><input type="date" name="sale_date" value="${today()}" required></label><label class="field"><span>Comprador</span><input name="buyer"></label><label class="field"><span>Cantidad vendida *</span><input type="number" name="quantity" min="1" max="${Math.max(1,Math.round(Number(product.stock_quantity)||0))}" step="1" value="1" required></label><label class="field"><span>Precio de venta por unidad *</span><input type="number" name="unit_sale_price_ars" min="0.01" step="0.01" value="${h(product.sale_price_ars||'')}" required></label><label class="field"><span>Cotización del dólar *</span><input type="number" name="usd_rate" min="0.01" step="0.01" required></label><label class="field full"><span>Notas</span><textarea name="notes"></textarea></label></div><section class="sale-allocation"><div class="sale-allocation-summary"><div><small>Total de la venta</small><strong data-sale-total>${moneyARS(0)}</strong></div><div class="material-recovery"><small>Chiara · recuperar materiales</small><strong data-sale-recovery>${moneyARS(0)}</strong></div><div><small>Resta repartir</small><strong data-sale-profit>${moneyARS(0)}</strong></div></div><h3>Distribución de la ganancia</h3><div class="form-grid two-columns"><label class="field"><span>Chiara</span><input type="number" name="chiara_profit_ars" min="0" step="0.01"></label><label class="field"><span>Felipe</span><input type="number" name="felipe_profit_ars" min="0" step="0.01"></label></div><div class="sale-remaining" data-sale-remaining-box><span>Falta distribuir</span><strong data-sale-remaining>${moneyARS(0)}</strong></div></section><button class="btn btn-primary" type="submit">Aceptar reparto y registrar venta</button></form>`, true);
        const form=document.querySelector('[data-form="la-ruda-sale-save"]');
        form?.addEventListener('input',updateLaRudaSaleSplit);updateLaRudaSaleSplit();
    }

    async function openLaRudaProductHistory(id) {
        const data=await api('la_ruda_product_history',{params:{id}}),p=data.product;
        const movements=p.movements||[],made=p.production_history||[],sales=p.sales_history||[];
        const avg=Number(p.stock_quantity)>0?Number(p.stock_value_ars)/Number(p.stock_quantity):0;
        showAppModal(`Producto · ${p.name}`, `<section class="product-history-hero product-history-with-photo">${productPhoto(p,'product-history-photo')}<div class="product-history-copy"><span class="product-line">${h(p.category_name||'Sin categoría')}</span><h2>${h(p.name)}</h2><p>${integerQty(p.grams_per_unit)} g por unidad · ${Number(p.stage_count||0)} etapas</p></div><div class="stock-number"><strong>${integerQty(p.stock_quantity)}</strong><span>unidades</span></div></section><section class="inventory-value-strip"><div><small>Valor del material en stock</small><strong>${moneyARS(p.stock_value_ars)}</strong><span>${moneyUSD(p.stock_value_usd)}</span></div><div><small>Costo promedio por unidad</small><strong>${moneyARS(avg)}</strong></div><div><small>Material contenido</small><strong>${gramsLabel(Number(p.stock_quantity)*Number(p.grams_per_unit))}</strong></div></section><div class="product-history-actions"><button class="btn btn-secondary" data-command="la-ruda-product-edit" data-id="${p.id}">Editar</button><button class="btn btn-secondary" data-command="la-ruda-production-new" data-id="${p.id}">Fabricar</button><button class="btn btn-secondary" data-command="la-ruda-stock-open" data-id="${p.id}">Ajustar stock</button><button class="btn btn-secondary" data-command="la-ruda-publish-open" data-id="${p.id}">Publicación</button><button class="btn btn-danger" data-command="la-ruda-product-delete" data-id="${p.id}">Eliminar</button></div><section class="product-history-section"><h3>Etapas habituales</h3><div class="product-stage-mini">${(p.stages||[]).map(x=>`<span>${h(x.name)}</span>`).join('')}</div></section><section class="product-history-section"><h3>Fabricaciones</h3>${made.length?`<div class="manufacturing-history-list">${made.map(x=>`<article><span>${x.status==='terminada'?'✓':'◷'}</span><div><strong>${integerQty(x.quantity)} unidades · ${gramsLabel(x.total_grams)}</strong><small>${formatDate(x.production_date)} · material ${moneyARS(x.material_cost_ars)} (${moneyUSD(x.material_cost_usd)})${x.completed_by_name?` · ${h(x.completed_by_name)}`:''}</small></div></article>`).join('')}</div>`:'<p class="muted">Todavía no hay fabricaciones.</p>'}</section><section class="product-history-section"><h3>Ventas</h3>${sales.length?`<div class="stock-history-list">${sales.map(x=>`<article class="positive"><time>${formatDate(x.sale_date)}</time><strong>${integerQty(x.quantity)} unidades</strong><div><span>${moneyARS(x.total_sale_ars)} · ${h(x.buyer||'Venta')}</span><small>Material recuperado ${moneyARS(x.material_cost_recovered_ars)} · ganancia ${moneyARS(x.profit_ars)}</small></div></article>`).join('')}</div>`:'<p class="muted">Todavía no hay ventas.</p>'}</section><section class="product-history-section"><h3>Historial de stock</h3>${movements.length?`<div class="stock-history-list">${movements.map(m=>`<article class="${Number(m.quantity_change)>=0?'positive':'negative'}"><time>${formatDate(m.movement_date)}</time><strong>${Number(m.quantity_change)>=0?'+':''}${integerQty(m.quantity_change)} un.</strong><div><span>${h(m.notes||'Movimiento de stock')}</span><small>${Number(m.grams_used)?`${gramsLabel(m.grams_used)} · `:''}${Number(m.material_cost_ars)?moneyARS(Math.abs(Number(m.material_cost_ars))):''}${m.created_by_name?` · ${h(m.created_by_name)}`:''}</small></div></article>`).join('')}</div>`:'<p class="muted">Todavía no hay movimientos.</p>'}</section>`, true);
    }

    function formatFileSize(value) {
        const bytes=Number(value)||0;if(bytes<1024)return `${bytes} B`;if(bytes<1024*1024)return `${(bytes/1024).toLocaleString('es-AR',{maximumFractionDigits:1})} KB`;return `${(bytes/1024/1024).toLocaleString('es-AR',{maximumFractionDigits:2})} MB`;
    }

    function openLaRudaModelForm(model = {}) {
        const products=state.laRudaData?.products||[];
        showAppModal(model.id?'Editar modelo 3D':'Agregar modelo 3D', `<form data-form="la-ruda-model-save" enctype="multipart/form-data"><input type="hidden" name="id" value="${model.id||''}"><div class="model-3d-upload-hero"><span>3D</span><div><strong>${h(model.original_name||'Archivo de fabricación')}</strong><small>${model.file_extension?`${h(String(model.file_extension).toUpperCase())} · ${formatFileSize(model.size_bytes)}`:'3MF, STL, OBJ, STEP y otros formatos de diseño.'}</small></div></div><div class="form-grid two-columns"><label class="field full"><span>Nombre *</span><input name="name" required value="${h(model.name||'')}" placeholder="Ej.: Núcleo Baby v3"></label><label class="field"><span>Producto relacionado</span><select name="product_id"><option value="">Sin relacionar</option>${products.map(p=>`<option value="${p.id}" ${String(model.product_id||'')===String(p.id)?'selected':''}>${h(p.name)}</option>`).join('')}</select></label><label class="field"><span>Categoría</span><input name="category_name" value="${h(model.category_name||'')}" placeholder="Núcleos, jaulas, accesorios"></label><label class="field"><span>Versión</span><input name="version_label" value="${h(model.version_label||'')}" placeholder="Ej.: v2.1"></label><label class="field"><span>Archivo ${model.id?'nuevo (opcional)':'*'}</span><input type="file" name="model_file" ${model.id?'':'required'} accept=".3mf,.stl,.obj,.step,.stp,.scad,.amf,.ply,.glb,.gltf,.fcstd,.f3d,.blend,.skp,.zip"><small>El archivo queda protegido y entra en la copia completa. Se aplica el límite de carga configurado en el servidor.</small></label><label class="field full"><span>Descripción o notas</span><textarea name="description" rows="4">${h(model.description||'')}</textarea></label></div><div class="form-actions"><button class="btn btn-primary">${model.id?'Guardar cambios':'Guardar modelo 3D'}</button><button type="button" class="btn btn-ghost" data-command="modal-close">Cancelar</button></div></form>`, false);
    }

    async function renderLaRuda(params) {
        loading('Abriendo Apiario La Ruda…');
        const data=await api('la_ruda_dashboard');state.laRudaData=data;
        const view=params.get('view')||'pedidos',summary=data.summary||{};
        const active=(data.orders||[]).filter(o=>!['entregado','cancelado'].includes(o.status));
        const delivered=(data.orders||[]).filter(o=>o.status==='entregado');
        const fabricationOpen=(data.fabrication||[]).filter(x=>x.status==='en_proceso');
        const fabricationDone=(data.fabrication||[]).filter(x=>x.status==='terminada');
        const orderCards=rows=>rows.length?`<div class="la-ruda-order-grid">${rows.map(o=>{const pct=Number(o.stage_count)?Math.round(Number(o.completed_count)*100/Number(o.stage_count)):0;return `<button class="la-ruda-order-card status-${h(o.status)}" type="button" data-command="la-ruda-order-open" data-id="${o.id}"><div class="la-ruda-order-card-top"><span class="la-ruda-status status-${h(o.status)}">${h(laRudaStatusLabel(o.status))}</span><strong>#${o.id}</strong></div><h3>${h(o.customer_name)}</h3><p>${Number(o.item_count||0)} productos · ${moneyARS(o.total_amount)}</p><div class="production-progress"><span><i style="width:${pct}%"></i></span><small>${pct}% de etapas</small></div><footer><span>${formatDate(o.order_date)}</span><span>${o.due_date?`Entrega ${formatDate(o.due_date)}`:'Sin fecha de entrega'}</span></footer></button>`}).join('')}</div>`:emptyState('◆','Sin pedidos','No hay pedidos en esta vista.');
        const stockCards=(data.products||[]).length?`<div class="la-ruda-product-grid">${data.products.map(p=>`<article class="la-ruda-product-card">${productPhoto(p)}<button class="la-ruda-product-open" type="button" data-command="la-ruda-product-open" data-id="${p.id}"><header><span class="product-line">${h(p.category_name||'Sin categoría')}</span>${Number(p.published_active)?'<strong class="published-chip">Publicado</strong>':''}</header><h3>${h(p.name)}</h3><div class="stock-number"><strong>${integerQty(p.stock_quantity)}</strong><span>unidades</span></div><div class="product-cost-mini"><span>${integerQty(p.grams_per_unit)} g/unidad</span><span>${moneyARS(p.stock_value_ars)} en materiales</span></div><div class="product-stage-mini">${(p.stages||[]).map(x=>`<span>${h(x.name)}</span>`).join('')}</div><span class="product-history-link">Ver historial →</span></button><div class="la-ruda-product-actions"><button class="btn btn-small btn-secondary" data-command="la-ruda-production-new" data-id="${p.id}">Fabricar</button><button class="icon-button danger" data-command="la-ruda-product-delete" data-id="${p.id}" title="Eliminar producto">×</button></div></article>`).join('')}</div>`:emptyState('◆','Catálogo vacío','Cree sus productos con foto, gramos y etapas.');
        const fabricationCards=`<section class="fabrication-board"><div class="panel-header"><div><h2>En fabricación</h2><p>Cada lote guarda gramos usados, costo del material y cotización.</p></div><button class="btn btn-primary" data-command="la-ruda-production-new">+ Iniciar fabricación</button></div>${fabricationOpen.length?`<div class="fabrication-grid">${fabricationOpen.map(x=>{const pct=Number(x.stage_count)?Math.round(Number(x.completed_count)*100/Number(x.stage_count)):0;return `<article class="fabrication-card"><header><span class="la-ruda-status status-produccion">Fabricación #${x.id}</span><strong>${pct}%</strong></header><h3>${integerQty(x.quantity)} unidades · ${h(x.product_name)}</h3><p>${gramsLabel(x.total_grams)} · ${moneyARS(x.material_cost_ars)} · ${moneyUSD(x.material_cost_usd)}</p><div class="production-progress"><span><i style="width:${pct}%"></i></span><small>${Number(x.completed_count||0)} de ${Number(x.stage_count||0)} etapas</small></div><div class="production-stage-list compact">${(x.stages||[]).map(stage=>`<button type="button" class="production-stage ${Number(stage.completed)?'done':''}" data-command="la-ruda-production-stage-toggle" data-id="${stage.id}" data-completed="${Number(stage.completed)?0:1}"><span>${Number(stage.completed)?'✓':'○'}</span><strong>${h(stage.stage_name)}</strong></button>`).join('')}</div><footer><button class="btn btn-small btn-ghost" data-command="la-ruda-production-delete" data-id="${x.id}">Cancelar</button><button class="btn btn-small btn-primary" data-command="la-ruda-production-complete" data-id="${x.id}" ${pct<100?'disabled title="Complete todas las etapas"':''}>Confirmar terminado</button></footer></article>`}).join('')}</div>`:emptyState('✓','No hay fabricaciones en curso','Inicie un lote y registre su costo real de material.')}</section>${fabricationDone.length?`<section class="panel fabrication-history-panel"><div class="panel-header"><div><h2>Fabricación finalizada</h2><p>Stock y costos ingresados automáticamente.</p></div></div><div class="manufacturing-history-list">${fabricationDone.slice(0,50).map(x=>`<article><span>✓</span><div><strong>${integerQty(x.quantity)} unidades · ${h(x.product_name)}</strong><small>${gramsLabel(x.total_grams)} · Costo de fabricación: -${moneyARS(x.material_cost_ars)} · ${formatDateTime(x.completed_at)}${x.completed_by_name?` · ${h(x.completed_by_name)}`:''}</small></div></article>`).join('')}</div></section>`:''}`;
        const publishedCards=(data.published||[]).length?`<div class="published-products-grid">${data.published.map(p=>`<article class="published-product-card">${productPhoto(p,'published-product-photo')}<div><span class="product-line">${h(p.category_name||'Artículo')}</span><h3>${h(p.name)}</h3><strong class="published-price">${moneyARS(p.sale_price_ars)}</strong><p>Stock: ${integerQty(p.stock_quantity)} · costo promedio ${moneyARS(p.average_cost_ars)}</p><div class="published-actions"><button class="btn btn-small btn-secondary" data-command="la-ruda-publish-open" data-id="${p.id}">Editar precio</button><button class="btn btn-small btn-primary" data-command="la-ruda-sale-open" data-id="${p.id}" ${Number(p.stock_quantity)<1?'disabled':''}>Se vendió</button></div></div></article>`).join('')}</div>`:emptyState('$','Sin artículos publicados','Defina el precio de un producto y publíquelo.');
        const salesHistory=(data.sales||[]).length?`<section class="panel sales-history-panel"><div class="panel-header"><div><h2>Ventas registradas</h2><p>Separación entre recuperación de materiales y ganancia.</p></div></div><div class="stock-history-list">${data.sales.map(s=>`<article class="positive"><time>${formatDate(s.sale_date)}</time><strong>${integerQty(s.quantity)} un.</strong><div><span>${h(s.product_name)} · ${moneyARS(s.total_sale_ars)}</span><small>Chiara: ${moneyARS(s.material_cost_recovered_ars)} · Venta de insumos: ${moneyARS(s.profit_ars)}${s.buyer?` · ${h(s.buyer)}`:''}</small></div></article>`).join('')}</div></section>`:'';
        const publishedPage=`${publishedCards}${salesHistory}`;
        const models=data.models||[];
        const modelsPage=`<section class="models-3d-head panel"><div><span class="eyebrow">BIBLIOTECA DE FABRICACIÓN</span><h2>Modelos 3D</h2><p>Archivos originales protegidos, relacionados con cada producto y disponibles para descargar cuando los necesite.</p></div><button class="btn btn-primary" data-command="la-ruda-model-new">+ Agregar modelo</button></section>${models.length?`<div class="models-3d-grid">${models.map(m=>`<article class="model-3d-card"><div class="model-3d-file-icon"><strong>${h(String(m.file_extension||'3D').toUpperCase())}</strong><small>${formatFileSize(m.size_bytes)}</small></div><div class="model-3d-copy"><span class="product-line">${h(m.category_name||'Modelo 3D')}</span><h3>${h(m.name)}</h3><p>${h(m.product_name||'Sin producto relacionado')}${m.version_label?` · ${h(m.version_label)}`:''}</p>${m.description?`<small>${h(m.description)}</small>`:''}<footer><span>${formatDateTime(m.created_at)}</span>${m.created_by_name?`<span>${h(m.created_by_name)}</span>`:''}</footer></div><div class="model-3d-actions"><button class="btn btn-small btn-primary" data-command="la-ruda-model-download" data-id="${m.id}" data-name="${h(m.original_name)}">Descargar</button><button class="icon-button" data-command="la-ruda-model-edit" data-id="${m.id}" title="Editar">✎</button><button class="icon-button danger" data-command="la-ruda-model-delete" data-id="${m.id}" title="Eliminar">×</button></div></article>`).join('')}</div>`:emptyState('3D','Todavía no hay modelos','Agregue el primer archivo de impresión o diseño.')}`;
        const page=view==='stock'?stockCards:view==='fabricacion'?fabricationCards:view==='publicados'?publishedPage:view==='modelos'?modelsPage:view==='entregados'?orderCards(delivered):orderCards(active);
        shell({title:'Apiario La Ruda',subtitle:'Pedidos, fabricación, stock valorizado, modelos y ventas',active:'la-ruda',actions:'<button class="btn btn-secondary" data-command="la-ruda-product-new">+ Producto</button><button class="btn btn-secondary" data-command="la-ruda-production-new">+ Fabricar</button><button class="btn btn-primary" data-command="la-ruda-order-new">+ Nuevo pedido</button>',content:`<section class="la-ruda-hero panel"><div class="la-ruda-mark">◆</div><div><span class="eyebrow">APIARIO LA RUDA</span><h2>Fabricar, valorar el stock y vender</h2><p>Cada gramo utilizado queda relacionado con el costo real del producto.</p></div></section><section class="la-ruda-summary la-ruda-summary-v17"><article><small>Pedidos activos</small><strong>${integerQty(summary.active)}</strong></article><article><small>En fabricación</small><strong>${integerQty(summary.fabricating)}</strong></article><article class="inventory-value-card"><small>Material valorizado en stock</small><strong>${moneyARS(summary.value_ars)}</strong><span>${moneyUSD(summary.value_usd)}</span></article><article><small>Modelos 3D</small><strong>${integerQty(summary.models_3d)}</strong></article></section><nav class="la-ruda-tabs"><a class="${view==='pedidos'?'active':''}" href="#/apiario-la-ruda?view=pedidos">Pedidos activos</a><a class="${view==='fabricacion'?'active':''}" href="#/apiario-la-ruda?view=fabricacion">Fabricación</a><a class="${view==='stock'?'active':''}" href="#/apiario-la-ruda?view=stock">Stock y productos</a><a class="${view==='modelos'?'active':''}" href="#/apiario-la-ruda?view=modelos">Modelos 3D</a><a class="${view==='publicados'?'active':''}" href="#/apiario-la-ruda?view=publicados">Artículos publicados</a><a class="${view==='entregados'?'active':''}" href="#/apiario-la-ruda?view=entregados">Entregados</a></nav>${page}`});
    }


    function compactActivitiesCalendar(range, data) {
        const firstDay = new Date(`${range.from}T12:00:00`).getDay();
        const byDate = {};
        (data.events || []).forEach(x => { (byDate[x.start_date] ||= []).push({...x, kind:'manual'}); });
        (data.activities || []).forEach(x => { (byDate[x.start_date] ||= []).push({...x, kind:'activity'}); });
        const cells = [];
        for (let i=0;i<firstDay;i++) cells.push('<div class="activity-mini-day outside"></div>');
        for (let day=1;day<=range.last;day++) {
            const date=`${range.from.slice(0,8)}${String(day).padStart(2,'0')}`;
            const items=byDate[date]||[];
            const isToday=date===today();
            const visible=items.slice(0,2);
            cells.push(`<div class="activity-mini-day ${isToday?'is-today':''} ${items.length?'has-events':''}">
                <button class="activity-mini-day-hit" type="button" data-command="calendar-new" data-date="${date}" aria-label="Agregar evento el ${date}"></button>
                <div class="activity-mini-day-head"><span>${day}</span>${items.length?`<b>${items.length}</b>`:''}</div>
                <div class="activity-mini-events">${visible.map(x=>x.kind==='activity'
                    ? `<button type="button" class="activity-mini-event is-activity" data-command="activity-open" data-id="${x.id}" title="${h(x.title)}"><i></i>${h(x.title)}</button>`
                    : `<button type="button" class="activity-mini-event is-manual" data-command="calendar-edit" data-id="${x.id}" data-title="${h(x.title)}" data-type="${h(x.event_type)}" data-start="${h(x.start_date)}" data-end="${h(x.end_date||'')}" data-notes="${h(x.notes||'')}" title="${h(x.title)}"><i style="--event-color:${h(x.color||'#a69b24')}"></i>${h(x.title)}</button>`).join('')}${items.length>2?`<small>+${items.length-2} más</small>`:''}</div>
            </div>`);
        }
        const label=new Intl.DateTimeFormat('es-AR',{month:'long',year:'numeric'}).format(range.base);
        const eventCount=(data.events||[]).length, activityCount=(data.activities||[]).length;
        return `<section class="activities-calendar-panel panel">
            <div class="activities-calendar-toolbar">
                <a class="calendar-nav" href="#/activities?cal_offset=${range.offset-1}" aria-label="Mes anterior">←</a>
                <div class="activities-calendar-title"><small>${eventCount} eventos · ${activityCount} actividades</small><h2>${capitalize(label)}</h2></div>
                <a class="calendar-today" href="#/activities?cal_offset=0">Hoy</a>
                <a class="calendar-nav" href="#/activities?cal_offset=${range.offset+1}" aria-label="Mes siguiente">→</a>
                <div class="activities-calendar-actions"><button class="btn btn-small btn-secondary google-calendar-button" type="button" data-command="google-calendar-open" data-app="apicultura"><span>G</span> Google Calendar</button><button class="btn btn-small btn-primary" type="button" data-command="calendar-new">+ Evento</button></div>
            </div>
            <div class="activity-mini-calendar"><div class="activity-mini-weekday">Dom</div><div class="activity-mini-weekday">Lun</div><div class="activity-mini-weekday">Mar</div><div class="activity-mini-weekday">Mié</div><div class="activity-mini-weekday">Jue</div><div class="activity-mini-weekday">Vie</div><div class="activity-mini-weekday">Sáb</div>${cells.join('')}</div>
        </section>`;
    }

    async function renderActivities(params) {
        loading('Cargando actividades…');
        const filters = { hive_id: params.get('hive_id') || '', label_id: params.get('label_id') || '', q: params.get('q') || '' };
        const range = calendarMonthRange(params.get('cal_offset') || 0);
        const [data, calendarData] = await Promise.all([
            api('activities', { params: filters }),
            api('calendar_events', { params: { app_code:'apicultura', from:range.from, to:range.to } })
        ]);
        const archived = (data.activities || []).filter(item => Number((data.statuses || []).find(status => Number(status.id) === Number(item.status_id))?.is_closed));
        state.archivedActivities = archived;
        const openStatuses = (data.statuses || []).filter(status => !Number(status.is_closed));
        const closedStatus = (data.statuses || []).find(status => Number(status.is_closed));
        shell({
            title: 'Actividades', subtitle: 'Calendario y tablero de trabajo en una sola vista', active: 'activities',
            actions: `<button class="btn btn-secondary archived-button" type="button" data-command="activity-archive-open">Archivadas <strong>${archived.length}</strong></button><button class="btn btn-primary" type="button" data-command="activity-open">+ Nueva actividad</button>`,
            content: `${compactActivitiesCalendar(range, calendarData)}
                <section class="activities-board-section"><div class="activities-board-heading"><div><span>TRABAJO DEL APIARIO</span><h2>Tablero de actividades</h2></div></div>
                <form class="filter-bar" data-form="activity-filter"><label class="search-field"><span>⌕</span><input type="search" name="q" value="${h(filters.q)}" placeholder="Buscar actividad"></label><select name="hive_id"><option value="">Todas las colmenas</option>${(data.hives || []).map(item => `<option value="${item.id}" ${String(item.id) === String(filters.hive_id) ? 'selected' : ''}>${h(item.name)}</option>`).join('')}</select><select name="label_id"><option value="">Todas las etiquetas</option>${(data.labels || []).map(item => `<option value="${item.id}" ${String(item.id) === String(filters.label_id) ? 'selected' : ''}>${h(item.name)}</option>`).join('')}</select><button class="btn btn-secondary" type="submit">Filtrar</button><a class="btn btn-ghost" href="#/activities">Limpiar</a></form>
                <section class="kanban-board kanban-board-open" data-kanban-board>${openStatuses.map(status => {
                    const cards = (data.activities || []).filter(item => Number(item.status_id) === Number(status.id));
                    const purchases = status.slug === 'pendientes' ? (data.purchase_plans || []) : [];
                    return `<article class="kanban-column"><div class="kanban-header" style="--status-color:${h(status.color)}"><div><span></span><h2>${h(status.name)}</h2></div><strong>${cards.length + purchases.length}</strong></div><div class="kanban-list" data-status-id="${status.id}">${purchases.map(plan => `<article class="kanban-card purchase-kanban-card"><a href="#/purchase/${plan.id}"><div class="kanban-card-top"><span class="activity-label purchase-label">Compra pendiente</span><span class="purchase-card-symbol">▤</span></div><h3>${h(plan.title)}</h3>${plan.notes ? `<p>${h(plan.notes)}</p>` : ''}<div class="kanban-card-meta"><span>▤ ${h(monthLabel(plan.plan_month))}</span><span>${Number(plan.item_count || 0)} elementos</span><span>${moneyARS(plan.total_amount)}</span></div><small>Abrir compra planificada →</small></a></article>`).join('')}${cards.map(activity => `<article class="kanban-card priority-card-${h(activity.priority)}" draggable="true" data-activity-id="${activity.id}">${activity.preview_image_id ? `<button class="activity-thumb" type="button" data-command="open-file" data-file-type="activity" data-id="${activity.preview_image_id}" data-name="foto"><img data-protected-image data-file-type="activity" data-id="${activity.preview_image_id}" alt="Foto de actividad"></button>` : ''}<button class="activity-card-open" type="button" data-command="activity-open" data-id="${activity.id}"><div class="kanban-card-top">${activity.label_name ? `<span class="activity-label" style="--label-color:${h(activity.label_color)}">${h(activity.label_name)}</span>` : '<span></span>'}<span class="priority priority-${h(activity.priority)}">${capitalize(activity.priority)}</span></div><h3>${h(activity.title)}</h3>${activity.description ? `<p>${h(activity.description)}</p>` : ''}<div class="kanban-card-meta"><span>⬡ ${h(activity.hive_name || 'Sin colmena')}</span><span>◷ ${formatDate(activity.due_date)}</span></div>${activity.responsible ? `<small>Responsable: ${h(activity.responsible)}</small>` : ''}</button></article>`).join('')}</div></article>`;
                }).join('')}${closedStatus ? `<article class="kanban-column archive-kanban-column"><div class="kanban-header" style="--status-color:${h(closedStatus.color)}"><div><span></span><h2>${h(closedStatus.name)}</h2></div><strong>${archived.length}</strong></div><div class="kanban-list archive-drop-list" data-status-id="${closedStatus.id}"><div class="archive-column-message"><span>✓</span><strong>Arrastre aquí para finalizar</strong><small>Se archiva sin borrar fotos ni historial.</small><button type="button" class="btn btn-small btn-secondary" data-command="activity-archive-open">Ver archivadas (${archived.length})</button></div></div></article>` : ''}</section></section>`
        });
        initKanban();
        hydrateProtectedImages();
    }

    function initKanban() {
        const board = document.querySelector('[data-kanban-board]');
        if (!board) return;
        let dragged = null;
        document.querySelectorAll('.kanban-card[data-activity-id]').forEach(card => {
            card.addEventListener('dragstart', event => { dragged = card; card.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; });
            card.addEventListener('dragend', () => { card.classList.remove('dragging'); dragged = null; document.querySelectorAll('.kanban-list').forEach(list => list.classList.remove('drag-over')); });
        });
        document.querySelectorAll('.kanban-list').forEach(list => {
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
                try { await api('activity_status_update', { method: 'POST', data: payload }); toast(Number(list.dataset.statusId) === Number((document.querySelector('.archive-drop-list')||{}).dataset?.statusId) ? 'Actividad archivada' : 'Estado actualizado'); await route(); }
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
            title: 'Compras pendientes', subtitle: 'Presupuestos organizados por tarjetas mensuales', active: 'accounting',
            actions: '<a class="btn btn-ghost" href="#/accounting">← Contabilidad</a><a class="btn btn-primary" href="#/purchases?new=1">+ Agregar</a>',
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
        const editor = completed ? '' : `<section class="panel sticky-panel"><div class="panel-header"><div><h2>${editing ? 'Editar renglón' : 'Agregar elemento'}</h2><p>El total se calcula automáticamente</p></div></div><form data-form="purchase-item-save" data-purchase-item-form><input type="hidden" name="id" value="${editing?.id || ''}"><input type="hidden" name="plan_id" value="${plan.id}"><label class="field"><span>Elemento *</span><input type="text" name="item_name" required maxlength="180" value="${h(editing?.item_name || '')}" placeholder="Ej.: Alza mediana"></label><div class="form-grid two-columns"><label class="field"><span>Cantidad</span><input type="number" step="1" min="1" name="quantity" required value="${h(editing?.quantity || '1')}" data-quantity></label><label class="field"><span>Precio unitario</span><input type="number" step="0.01" min="0" name="unit_price" required value="${h(editing?.unit_price || '0')}" data-unit-price></label></div><div class="calculated-total"><small>Total del renglón</small><strong data-line-total>${moneyARS(Number(editing?.quantity || 1) * Number(editing?.unit_price || 0))}</strong></div><label class="field"><span>Lugar de compra</span><input type="text" name="purchase_place" maxlength="180" value="${h(editing?.purchase_place || '')}" placeholder="Proveedor o comercio"></label><label class="field"><span>Notas</span><textarea name="notes" rows="3">${h(editing?.notes || '')}</textarea></label><label class="checkbox-field"><input type="checkbox" name="is_purchased" value="1" ${Number(editing?.is_purchased || 0) ? 'checked' : ''}><span>Ya fue comprado</span></label><div class="form-actions"><button class="btn btn-primary" type="submit">${editing ? 'Guardar cambios' : '+ Agregar elemento'}</button>${editing ? `<a class="btn btn-ghost" href="#/purchase/${plan.id}">Cancelar</a>` : ''}</div></form><details><summary>Editar datos de la tarjeta</summary><form class="details-form" data-form="purchase-plan-save"><input type="hidden" name="id" value="${plan.id}"><label class="field"><span>Título</span><input name="title" value="${h(plan.title)}" required></label><label class="field"><span>Mes</span><input type="month" name="plan_month" value="${h(String(plan.plan_month).slice(0,7))}" required></label><label class="field"><span>Notas</span><textarea name="notes" rows="3">${h(plan.notes || '')}</textarea></label><button class="btn btn-secondary" type="submit">Actualizar tarjeta</button></form></details><button class="btn btn-danger" data-command="purchase-plan-delete" data-id="${plan.id}">Eliminar tarjeta completa</button></section>`;
        shell({
            title: plan.title, subtitle: completed ? 'Compra realizada' : 'Detalle del presupuesto planificado', active: 'accounting',
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
            actions: '<a class="btn btn-secondary accounting-purchases-button" href="#/purchases"><span>▤</span> Compras pendientes</a>',
            content: `<section class="accounting-hero apiculture-accounting-hero"><div><span>Balance del resultado</span><strong>${moneyUSD(Number(summary.income_usd || 0)-Number(summary.expense_usd || 0))}</strong><small>${moneyARS(Number(summary.income_ars || 0)-Number(summary.expense_ars || 0))}</small></div><div class="accounting-hero-split"><span><b>${moneyUSD(summary.income_usd)}</b><small>Ingresos</small></span><span><b>${moneyUSD(summary.expense_usd)}</b><small>Egresos</small></span><span class="accounting-count"><b>${Number(summary.total || 0)}</b><small>Movimientos</small></span></div></section><section class="balance-strip accounting-balances"><div class="balance-strip-title"><span>Saldo histórico por persona</span><small>Siempre muestra toda la existencia del proyecto</small></div>${(data.balances || []).map(balance => `<div class="person-balance ${Number(balance.balance_ars) < 0 ? 'negative' : 'positive'}"><strong>${h(balance.name)}</strong><span>${moneyUSD(balance.balance_usd)}</span><small>${moneyARS(balance.balance_ars)}</small></div>`).join('')}</section>
                <form class="filter-panel panel" data-form="accounting-filter"><div class="filter-panel-title"><strong>Filtrar movimientos</strong><small>Por ejemplo: desde octubre hasta noviembre de cualquier año</small></div><label class="field"><span>Desde</span><input type="date" name="date_from" value="${h(filters.date_from || '')}"></label><label class="field"><span>Hasta</span><input type="date" name="date_to" value="${h(filters.date_to || '')}"></label><label class="field"><span>Persona</span><select name="person_id"><option value="">Todas</option>${(data.people || []).map(person => `<option value="${person.id}" ${String(person.id) === String(filters.person_id || '') ? 'selected' : ''}>${h(person.name)}</option>`).join('')}</select></label><label class="field"><span>Tipo</span><select name="movement_type"><option value="">Ingresos y egresos</option><option value="ingreso" ${filters.movement_type === 'ingreso' ? 'selected' : ''}>Ingresos</option><option value="egreso" ${filters.movement_type === 'egreso' ? 'selected' : ''}>Egresos</option></select></label><label class="field"><span>Concepto</span><select name="concept_id"><option value="">Todos</option>${(data.concepts || []).map(concept => `<option value="${concept.id}" ${String(concept.id) === String(filters.concept_id || '') ? 'selected' : ''}>${h(concept.name)}</option>`).join('')}</select></label><label class="field filter-search"><span>Texto</span><input type="search" name="q" value="${h(filters.q || '')}" placeholder="Buscar en descripción"></label><div class="filter-actions"><button class="btn btn-secondary" type="submit">Aplicar filtros</button><a class="btn btn-ghost" href="#/accounting">Ver todo</a></div></form>
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


    const documentCategoryLabels = { renapa:'RENAPA', senasa:'SENASA', registro:'Registro', certificado:'Certificado', contrato:'Contrato', seguro:'Seguro', plano:'Plano', factura:'Factura', manual:'Manual', otro:'Otro' };

    async function openManagedDocument(appCode, id, name='documento') {
        const action = appCode === 'apicultura' ? 'apiculture_document_file' : 'document_file';
        const params = appCode === 'apicultura' ? { id } : { app_code:appCode, id };
        const preview = window.open('about:blank', '_blank');
        if (preview) preview.opener = null;
        try {
            const blob = await api(action, { params, blob:true });
            const url = URL.createObjectURL(blob); state.protectedUrls.push(url);
            if (preview) preview.location.href = url;
            else toast('El navegador bloqueó la vista del documento. Habilite ventanas emergentes para abrirlo.', 'error');
        } catch (error) {
            if (preview) preview.close();
            throw error;
        }
    }

    function openDocumentModal(appCode, document={}) {
        showAppModal(document.id ? 'Editar documento' : 'Agregar documento', `
            <form data-form="document-save" enctype="multipart/form-data">
                <input type="hidden" name="app_code" value="${h(appCode)}"><input type="hidden" name="id" value="${document.id||''}">
                <div class="form-grid two-columns">
                    <label class="field"><span>Nombre del documento *</span><input name="title" required maxlength="180" value="${h(document.title||'')}"></label>
                    <label class="field"><span>Categoría</span><select name="category">${Object.entries(documentCategoryLabels).map(([v,l])=>`<option value="${v}" ${document.category===v?'selected':''}>${l}</option>`).join('')}</select></label>
                    <label class="field"><span>Número</span><input name="document_number" value="${h(document.document_number||'')}" placeholder="Opcional"></label>
                    <label class="field"><span>Organismo o emisor</span><input name="issuer" value="${h(document.issuer||'')}" placeholder="SENASA, RENAPA, aseguradora…"></label>
                    <label class="field"><span>Fecha de emisión</span><input type="date" name="issue_date" value="${h(document.issue_date||'')}"></label>
                    <label class="field"><span>Vencimiento</span><input type="date" name="expiry_date" value="${h(document.expiry_date||'')}"></label>
                </div>
                <label class="field"><span>Notas</span><textarea name="notes">${h(document.notes||'')}</textarea></label>
                <label class="field"><span>${document.id?'Reemplazar archivo (opcional)':'Archivo *'}</span><input type="file" name="document" accept="application/pdf,image/jpeg,image/png,image/webp" ${document.id?'':'required'}></label>
                <div class="form-actions"><button class="btn btn-primary" type="submit">Guardar documento</button><button class="btn btn-ghost" type="button" data-command="modal-close">Cancelar</button></div>
            </form>`, false);
    }

    async function renderDocuments(params) {
        loading('Cargando documentos…');
        const filters={q:params.get('q')||'',category:params.get('category')||'',status:params.get('status')||''};
        const data=await api('apiculture_documents_list',{params:filters});state.managementDocuments=data.documents||[];
        const summary=data.summary||{};
        shell({title:'Documentos',subtitle:'Registros, certificados y archivos importantes del apiario',active:'documents',actions:'<button class="btn btn-primary" data-command="document-new">+ Agregar documento</button>',content:`
            <section class="summary-cards document-summary"><div><span>Total</span><strong>${Number(summary.total||0)}</strong><small>Documentos guardados</small></div><div class="warning"><span>Por vencer</span><strong>${Number(summary.expiring||0)}</strong><small>Próximos 45 días</small></div><div class="danger"><span>Vencidos</span><strong>${Number(summary.expired||0)}</strong><small>Requieren revisión</small></div></section>
            <form class="filter-bar" data-form="document-filter"><input name="q" value="${h(filters.q)}" placeholder="Buscar por nombre, número o emisor"><select name="category"><option value="">Todas las categorías</option>${Object.entries(documentCategoryLabels).map(([v,l])=>`<option value="${v}" ${filters.category===v?'selected':''}>${l}</option>`).join('')}</select><select name="status"><option value="">Todos</option><option value="vigente" ${filters.status==='vigente'?'selected':''}>Vigentes</option><option value="por_vencer" ${filters.status==='por_vencer'?'selected':''}>Por vencer</option><option value="vencido" ${filters.status==='vencido'?'selected':''}>Vencidos</option></select><button class="btn btn-secondary">Filtrar</button></form>
            ${(data.documents||[]).length?`<section class="document-grid">${data.documents.map(d=>{const days=d.days_to_expiry===null?null:Number(d.days_to_expiry);const expiry=days===null?'Sin vencimiento':days<0?`Vencido hace ${Math.abs(days)} días`:days<=45?`Vence en ${days} días`:`Vence ${formatDate(d.expiry_date)}`;return `<article class="document-card ${days!==null&&days<0?'is-expired':days!==null&&days<=45?'is-expiring':''}"><div class="document-card-icon">${String(d.mime_type||'').includes('pdf')?'PDF':'IMG'}</div><div class="document-card-body"><span class="document-category">${h(documentCategoryLabels[d.category]||'Otro')}</span><h3>${h(d.title)}</h3><p>${h(d.issuer||'Sin emisor')}${d.document_number?` · Nº ${h(d.document_number)}`:''}</p><div class="document-expiry">${h(expiry)}</div><small>Subió: ${h(d.uploaded_by_name||'—')}</small></div><div class="document-card-actions"><button class="btn btn-small btn-primary" data-command="document-open" data-id="${d.id}" data-name="${h(d.original_name)}">Abrir</button><button class="btn btn-small btn-ghost" data-command="document-edit" data-id="${d.id}">Editar</button><button class="icon-button danger" data-command="document-delete" data-id="${d.id}">×</button></div></article>`}).join('')}</section>`:emptyState('▤','No hay documentos','Agregue RENAPA, certificados, planos, contratos u otros archivos importantes.')}`});
    }

    function openQueenRearingModal(item={}) {
        const hives=state.queenRearingHives||[];
        showAppModal(item.id?'Actualizar crianza':'Iniciar nueva crianza',`<form data-form="queen-rearing-save"><input type="hidden" name="app_code" value="apicultura"><input type="hidden" name="id" value="${item.id||''}"><div class="form-grid two-columns"><label class="field"><span>Nombre o lote *</span><input name="name" required value="${h(item.name||'')}" placeholder="Ej. Lote primavera 1"></label><label class="field"><span>Colmena de origen</span><select name="source_hive_id"><option value="">Sin especificar</option>${hives.map(x=>`<option value="${x.id}" ${String(item.source_hive_id||'')===String(x.id)?'selected':''}>${h(x.name)}</option>`).join('')}</select></label><label class="field"><span>Dónde quedó instalado</span><input name="location" value="${h(item.location||'')}" placeholder="Starter, criadora, colmena…"></label><label class="field"><span>Punto de inicio</span><select name="start_point"><option value="huevo" ${item.start_point==='huevo'?'selected':''}>Huevo o puesta</option><option value="traslarve" ${!item.start_point||item.start_point==='traslarve'?'selected':''}>Traslarve</option><option value="celda_operculada" ${item.start_point==='celda_operculada'?'selected':''}>Celda operculada</option></select></label><label class="field"><span>Fecha de inicio *</span><input type="date" name="start_date" required value="${h(item.start_date||today())}"></label><label class="field"><span>Días estimados</span><input type="number" min="1" max="30" name="estimated_days" value="${item.estimated_days||12}"></label><label class="field"><span>Reinas proyectadas</span><input type="number" min="0" step="1" name="projected_queens" value="${item.projected_queens||0}"></label></div><label class="field"><span>Observaciones</span><textarea name="notes">${h(item.notes||'')}</textarea></label><div class="form-actions"><button class="btn btn-primary">${item.id?'Guardar cambios':'Iniciar crianza'}</button><button type="button" class="btn btn-ghost" data-command="modal-close">Cancelar</button></div></form>`,true);
    }

    function openQueenRearingClose(item) {
        showAppModal(`Cerrar crianza · ${item.name}`,`<section class="queen-close-summary"><div><small>Reinas proyectadas</small><strong>${integerQty(item.projected_queens||0)}</strong></div><div><small>Nacimiento estimado</small><strong>${formatDate(item.expected_emergence_date)}</strong></div></section><form data-form="queen-rearing-close"><input type="hidden" name="app_code" value="apicultura"><input type="hidden" name="id" value="${item.id}"><div class="form-grid two-columns"><label class="field"><span>Reinas obtenidas *</span><input type="number" min="0" step="1" name="emerged_queens" required></label><label class="field"><span>Nuevas colmenas formadas</span><input type="number" min="0" step="1" name="formed_hives" value="0"></label></div><label class="field"><span>Observaciones del cierre</span><textarea name="closing_notes"></textarea></label><button class="btn btn-primary">Cerrar y guardar en historial</button></form>`,false);
    }

    async function renderQueenRearing() {
        loading('Cargando crianza de reinas…');const data=await api('queen_rearing_list',{params:{app_code:'apicultura'}});state.queenRearingBatches=data.batches||[];state.queenRearingHives=data.hives||[];
        const active=(data.batches||[]).filter(q=>!['finalizada','cancelada'].includes(q.status));
        const history=(data.batches||[]).filter(q=>['finalizada','cancelada'].includes(q.status));
        const card=q=>`<article class="queen-rearing-card status-${h(q.status)}"><div class="queen-rearing-date"><small>Nacimiento estimado</small><strong>${formatDate(q.expected_emergence_date)}</strong><span>${Number(q.days_remaining)>=0?`Faltan ${q.days_remaining} días`:'Fecha cumplida'}</span></div><div class="queen-rearing-body"><span class="badge">${q.status==='finalizada'?'Cerrada':q.status==='cancelada'?'Cancelada':'En curso'}</span><h3>${h(q.name)}</h3><p>${h(q.location||'Ubicación sin especificar')}${q.source_hive_name?` · Origen: ${h(q.source_hive_name)}`:''}</p><div class="queen-rearing-counts"><span><b>${integerQty(q.projected_queens||0)}</b> proyectadas</span>${q.status==='finalizada'?`<span><b>${integerQty(q.emerged_queens||0)}</b> obtenidas</span><span><b>${q.success_rate??0}%</b> efectividad</span>`:''}</div><small>Inició ${formatDate(q.start_date)} · ${h(q.created_by_name||'—')}</small></div><div class="queen-rearing-actions">${!['finalizada','cancelada'].includes(q.status)?`<button class="btn btn-small btn-primary" data-command="queen-rearing-close" data-id="${q.id}">Cerrar crianza</button><button class="btn btn-small btn-secondary" data-command="queen-rearing-edit" data-id="${q.id}">Editar</button>`:''}<button class="icon-button danger" data-command="queen-rearing-delete" data-id="${q.id}">×</button></div></article>`;
        shell({title:'Crianza de reinas',subtitle:'Lotes activos, nacimiento estimado y resultados',active:'queen-rearing',actions:'<button class="btn btn-primary" data-command="queen-rearing-new">+ Iniciar crianza</button>',content:`<section class="queen-rearing-section"><div class="panel-header"><div><h2>Crianzas en curso</h2><p>Quedan abiertas hasta registrar cuántas reinas se obtuvieron.</p></div><strong class="section-count">${active.length}</strong></div>${active.length?`<div class="queen-rearing-grid">${active.map(card).join('')}</div>`:emptyState('♛','No hay crianzas abiertas','Inicie un lote para calcular el nacimiento y crear su evento en el calendario.')}</section><section class="queen-rearing-section queen-rearing-history"><div class="panel-header"><div><h2>Historial</h2><p>Resultados y efectividad de los lotes cerrados.</p></div><strong class="section-count">${history.length}</strong></div>${history.length?`<div class="queen-rearing-grid">${history.map(card).join('')}</div>`:'<p class="muted">Todavía no hay crianzas cerradas.</p>'}</section>`});
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

    let protectedImageActive = 0;
    const protectedImageQueue = [];
    function withProtectedImageSlot(task) {
        return new Promise((resolve, reject) => {
            const run = async () => {
                protectedImageActive += 1;
                try { resolve(await task()); }
                catch (error) { reject(error); }
                finally {
                    protectedImageActive -= 1;
                    const next = protectedImageQueue.shift();
                    if (next) next();
                }
            };
            if (protectedImageActive < 4) run();
            else protectedImageQueue.push(run);
        });
    }

    const protectedImageObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            protectedImageObserver.unobserve(entry.target);
            loadProtectedImage(entry.target);
        });
    }, { rootMargin: '420px 0px' }) : null;

    async function loadProtectedImage(image) {
        if (!image || image.dataset.imageLoaded === '1' || image.dataset.imageHydrating === '1') return;
        image.dataset.imageHydrating = '1';
        image.classList.add('image-loading');
        try {
            const key = `thumb:${image.dataset.fileType}:${image.dataset.id}`;
            let url = state.imageCache.get(key);
            if (!url) {
                let lastError;
                for (let attempt = 0; attempt < 3 && !url; attempt++) {
                    try {
                        const blob = await withProtectedImageSlot(() => api('file', { params: { type: image.dataset.fileType, id: image.dataset.id, thumb: 1 }, blob: true }));
                        url = URL.createObjectURL(blob);
                        state.imageCache.set(key, url);
                    } catch (error) {
                        lastError = error;
                        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 280 * (attempt + 1)));
                    }
                }
                if (!url && lastError) throw lastError;
            }
            if (image.isConnected) {
                image.src = url;
                image.dataset.imageLoaded = '1';
                image.classList.add('image-ready');
            }
        } catch (_) {
            if (image.isConnected) {
                image.alt = 'Imagen no disponible';
                image.classList.add('image-error');
            }
        } finally {
            delete image.dataset.imageHydrating;
            image.classList.remove('image-loading');
        }
    }

    async function hydrateProtectedImages() {
        const images = [...document.querySelectorAll('[data-protected-image]')].filter(image => image.dataset.imageLoaded !== '1' && image.dataset.imageObserved !== '1');
        if (!images.length) return;
        images.forEach(image => {
            image.dataset.imageObserved = '1';
            if (protectedImageObserver) protectedImageObserver.observe(image);
            else loadProtectedImage(image);
        });
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
        const preview = window.open('about:blank', '_blank');
        if (preview) preview.opener = null;
        try {
            const blob = await api('file', { params: { type, id }, blob: true });
            const url = URL.createObjectURL(blob);
            state.protectedUrls.push(url);
            if (preview) preview.location.href = url;
            else toast('El navegador bloqueó la vista del archivo. Habilite ventanas emergentes para abrirlo.', 'error');
        } catch (error) {
            if (preview) preview.close();
            throw error;
        }
    }


    const technicalViews = [
        ['inspections','Inspecciones'],['harvests','Cosechas'],['health','Sanidad'],['feeding','Alimentación'],['performance','Rendimiento'],['seasons','Temporadas']
    ];
    const technicalTabs = view => `<nav class="technical-tabs">${technicalViews.map(([v,l])=>`<a class="${view===v?'active':''}" href="#/technical?view=${v}">${l}</a>`).join('')}</nav>`;
    const seasonOptions = (rows,current='') => (rows||[]).map(x=>`<option value="${x.id}" ${String(x.id)===String(current)?'selected':''}>${h(x.name)}${Number(x.is_active)?' · activa':''}</option>`).join('');
    const selectedHiveCards = (hives, selected=[]) => `<div class="technical-hive-picker">${(hives||[]).map(x=>`<label class="technical-hive-option"><input type="checkbox" name="hive_ids" value="${x.id}" ${selected.map(Number).includes(Number(x.id))?'checked':''}><span>⬡</span><strong>${h(x.name)}</strong></label>`).join('')}</div>`;

    async function ensureTechnicalBase() {
        if (!(state.apiaryTechnical?.hives || []).length || !(state.apiaryTechnical?.seasons || []).length) {
            const base = await api('apiary_overview');
            state.apiaryTechnical = { ...(state.apiaryTechnical || {}), ...base };
        }
        return state.apiaryTechnical;
    }

    async function openInspectionModal(item={}, defaults={}) {
        const base=await ensureTechnicalBase();
        const hives=base.hives||[]; const seasons=base.seasons||[];
        let files=[]; if(item.id){ try{const d=await api('apiary_inspection_get',{params:{id:item.id}});item=d.inspection||item;files=d.files||[];}catch(_){} }
        const selectedHive=item.hive_id||defaults.hiveId||'';
        const reserveOptions=value=>[['','Sin evaluar'],['buena','Buena'],['ok','OK'],['escasa','Escasa'],['insuficiente','Insuficiente']].map(([v,l])=>`<option value="${v}" ${String(value||'')===v?'selected':''}>${l}</option>`).join('');
        showAppModal(item.id?'Editar inspección':'Nueva inspección', `<div class="modal-form-layout technical-modal-layout"><form data-form="apiary-inspection-save"><input type="hidden" name="id" value="${item.id||''}"><div class="form-grid three-columns"><label class="field"><span>Colmena *</span><select name="hive_id" required><option value="">Seleccione</option>${hives.map(x=>`<option value="${x.id}" ${String(x.id)===String(selectedHive)?'selected':''}>${h(x.name)}</option>`).join('')}</select></label><label class="field"><span>Fecha *</span><input type="date" name="inspection_date" value="${item.inspection_date||today()}" required></label><label class="field"><span>Temporada</span><select name="season_id">${seasonOptions(seasons,item.season_id||base.season?.id)}</select></label></div><div class="technical-check-row"><label><input type="checkbox" name="queen_seen" value="1" ${Number(item.queen_seen)?'checked':''}> Reina vista</label><label><input type="checkbox" name="swarm_signs" value="1" ${Number(item.swarm_signs)?'checked':''}> Signos de enjambrazón</label></div><div class="form-grid three-columns"><label class="field"><span>Postura</span><select name="laying_status">${[['sin_evaluar','Sin evaluar'],['buena','Buena'],['irregular','Irregular'],['sin_postura','Sin postura']].map(([v,l])=>`<option value="${v}" ${(item.laying_status||'sin_evaluar')===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="field"><span>Cuadros cubiertos de abejas</span><input type="number" min="0" step="1" name="frames_bees" value="${item.frames_bees??''}"></label><label class="field"><span>Reservas de miel</span><select name="honey_reserve_status">${reserveOptions(item.honey_reserve_status)}</select></label><label class="field"><span>Reservas de polen</span><select name="pollen_reserve_status">${reserveOptions(item.pollen_reserve_status)}</select></label><label class="field"><span>Celdas reales</span><input type="number" min="0" step="1" name="queen_cells" value="${item.queen_cells??''}"></label><label class="field"><span>Temperamento</span><select name="temperament"><option value="">Sin evaluar</option>${['mansa','normal','nerviosa','agresiva'].map(v=>`<option value="${v}" ${item.temperament===v?'selected':''}>${capitalize(v)}</option>`).join('')}</select></label></div><label class="field"><span>Observaciones</span><textarea name="notes" rows="4">${h(item.notes||'')}</textarea></label>${item.id?'':`<label class="field"><span>Fotos o PDF</span><input type="file" name="inspection_files" multiple accept="image/jpeg,image/png,image/webp,application/pdf"></label>`}<div class="form-actions"><button class="btn btn-primary">Guardar inspección</button>${item.id?`<button class="btn btn-danger" type="button" data-command="apiary-inspection-delete" data-id="${item.id}">Eliminar</button>`:''}</div></form>${item.id?`<aside class="modal-side-panel"><h3>Fotos y archivos</h3><form data-form="apiary-inspection-file-upload" enctype="multipart/form-data"><input type="hidden" name="inspection_id" value="${item.id}"><input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" required><button class="btn btn-small btn-secondary">Agregar</button></form><div class="modal-attachment-grid">${files.map(f=>`<article>${String(f.mime_type).startsWith('image/')?`<img data-protected-image data-file-type="apiary_inspection" data-id="${f.id}" alt="${h(f.original_name)}">`:'<div class="pdf-preview">PDF</div>'}<button class="file-link" type="button" data-command="open-file" data-file-type="apiary_inspection" data-id="${f.id}" data-name="${h(f.original_name)}">${h(f.original_name)}</button><button class="icon-button danger" type="button" data-command="apiary-inspection-file-delete" data-id="${f.id}" data-inspection-id="${item.id}">×</button></article>`).join('')}</div></aside>`:''}</div>`);
    }

    function openHarvestModal(item={}) {
        const base=state.apiaryTechnical||{}; const selected=(item.hives||[]).map(x=>Number(x.hive_id)); const kgMap=new Map((item.hives||[]).map(x=>[Number(x.hive_id),x.attributed_kg]));
        showAppModal(item.id?'Editar cosecha':'Nueva cosecha', `<form data-form="apiary-harvest-save"><input type="hidden" name="id" value="${item.id||''}"><div class="form-grid three-columns"><label class="field"><span>Fecha *</span><input type="date" name="harvest_date" value="${item.harvest_date||today()}" required></label><label class="field"><span>Temporada</span><select name="season_id">${seasonOptions(base.seasons,item.season_id||base.season?.id)}</select></label><label class="field"><span>Lote de miel</span><input name="batch_code" value="${h(item.batch_code||'')}" placeholder="Ej.: M-2026-04"></label><label class="field"><span>Tipo de miel</span><input name="honey_type" value="${h(item.honey_type||'')}"></label><label class="field"><span>Total kg *</span><input type="number" min="0" step="0.001" name="total_kg" required value="${item.total_kg??''}"></label><label class="field"><span>Humedad %</span><input type="number" min="0" max="100" step="0.1" name="moisture_pct" value="${item.moisture_pct??''}"></label><label class="field full"><span>Recipientes / tambores</span><input name="containers" value="${h(item.containers||'')}"></label></div><h3 class="form-section-title">Aporte por colmena</h3><p class="muted">Indique los kilos atribuidos a cada colmena. Si deja todos en cero, el total se distribuirá por partes iguales.</p><div class="harvest-hive-grid">${(base.hives||[]).map(x=>`<label class="harvest-hive-row"><input type="checkbox" name="hive_ids" value="${x.id}" ${selected.includes(Number(x.id))?'checked':''}><strong>${h(x.name)}</strong><span><input type="number" min="0" step="0.001" name="hive_kg_${x.id}" value="${kgMap.get(Number(x.id))??''}" placeholder="kg"> kg</span></label>`).join('')}</div><label class="field"><span>Observaciones</span><textarea name="notes" rows="3">${h(item.notes||'')}</textarea></label><div class="form-actions"><button class="btn btn-primary">Guardar cosecha</button>${item.id?`<button class="btn btn-danger" type="button" data-command="apiary-harvest-delete" data-id="${item.id}">Eliminar</button>`:''}</div></form>`);
    }

    async function openHealthModal(item={},defaults={}) {
        const base=await ensureTechnicalBase();let selected=(item.hives||[]).map(x=>Number(x.hive_id));if(defaults.hiveId&&!selected.length)selected=[Number(defaults.hiveId)];
        showAppModal(item.id?'Editar registro sanitario':'Nuevo registro sanitario', `<form data-form="apiary-health-save"><input type="hidden" name="id" value="${item.id||''}"><div class="form-grid three-columns"><label class="field"><span>Fecha *</span><input type="date" name="record_date" value="${item.record_date||today()}" required></label><label class="field"><span>Temporada</span><select name="season_id">${seasonOptions(base.seasons,item.season_id||base.season?.id)}</select></label><label class="field"><span>Tipo *</span><select name="treatment_type" required>${[['tratamiento','Tratamiento'],['control_varroa','Control Varroa'],['control_nosema','Control Nosema'],['loque','Loque / control de cría'],['medicacion','Medicación'],['diagnostico','Diagnóstico'],['otro','Otro']].map(([v,l])=>`<option value="${v}" ${item.treatment_type===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="field"><span>Problema / enfermedad</span><input name="condition_name" value="${h(item.condition_name||'')}" placeholder="Ej.: Varroa"></label><label class="field"><span>Producto</span><input name="product" value="${h(item.product||'')}"></label><label class="field"><span>Dosis</span><input name="dose" value="${h(item.dose||'')}"></label><label class="field"><span>Fin del tratamiento</span><input type="date" name="end_date" value="${item.end_date||''}"></label><label class="field"><span>Resultado</span><input name="result" value="${h(item.result||'')}"></label></div><h3 class="form-section-title">Colmenas</h3>${selectedHiveCards(base.hives,selected)}<label class="field"><span>Observaciones</span><textarea name="notes" rows="3">${h(item.notes||'')}</textarea></label><div class="form-actions"><button class="btn btn-primary">Guardar registro</button>${item.id?`<button class="btn btn-danger" type="button" data-command="apiary-health-delete" data-id="${item.id}">Eliminar</button>`:''}</div></form>`);
    }

    async function openFeedingModal(item={},defaults={}) {
        const base=await ensureTechnicalBase();let selected=(item.hives||[]).map(x=>Number(x.hive_id));if(defaults.hiveId&&!selected.length)selected=[Number(defaults.hiveId)];
        showAppModal(item.id?'Editar alimentación':'Nueva alimentación', `<form data-form="apiary-feeding-save"><input type="hidden" name="id" value="${item.id||''}"><div class="form-grid three-columns"><label class="field"><span>Fecha *</span><input type="date" name="feeding_date" value="${item.feeding_date||today()}" required></label><label class="field"><span>Temporada</span><select name="season_id">${seasonOptions(base.seasons,item.season_id||base.season?.id)}</select></label><label class="field"><span>Alimento *</span><select name="feed_type" required>${['Jarabe','Torta proteica','Fondant','Azúcar','Suplemento proteico','Otro'].map(v=>`<option value="${v}" ${item.feed_type===v?'selected':''}>${v}</option>`).join('')}</select></label><label class="field"><span>Cantidad por colmena *</span><input type="number" min="0.001" step="0.001" name="quantity_per_hive" required value="${item.quantity_per_hive??''}"></label><label class="field"><span>Unidad</span><select name="unit">${[['kg','kg'],['l','litros'],['unidad','unidades']].map(([v,l])=>`<option value="${v}" ${item.unit===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="field"><span>Motivo</span><input name="reason" value="${h(item.reason||'')}"></label></div><h3 class="form-section-title">Colmenas</h3>${selectedHiveCards(base.hives,selected)}<label class="field"><span>Observaciones</span><textarea name="notes" rows="3">${h(item.notes||'')}</textarea></label><div class="form-actions"><button class="btn btn-primary">Guardar alimentación</button>${item.id?`<button class="btn btn-danger" type="button" data-command="apiary-feeding-delete" data-id="${item.id}">Eliminar</button>`:''}</div></form>`);
    }

    function openSeasonModal(item={}) {
        showAppModal(item.id?'Editar temporada':'Nueva temporada', `<form data-form="apiary-season-save"><input type="hidden" name="id" value="${item.id||''}"><label class="field"><span>Nombre *</span><input name="name" required value="${h(item.name||'')}" placeholder="Ej.: 2026/27"></label><div class="form-grid two-columns"><label class="field"><span>Inicio *</span><input type="date" name="start_date" required value="${item.start_date||''}"></label><label class="field"><span>Fin *</span><input type="date" name="end_date" required value="${item.end_date||''}"></label></div><label class="checkbox-field"><input type="checkbox" name="is_active" value="1" ${Number(item.is_active)?'checked':''}><span>Usar como temporada activa</span></label><label class="field"><span>Notas</span><textarea name="notes" rows="3">${h(item.notes||'')}</textarea></label><button class="btn btn-primary">Guardar temporada</button></form>`,false);
    }

    async function renderTechnical(params) {
        loading('Cargando manejo…');
        const view=params.get('view')||'inspections'; const seasonId=Number(params.get('season_id')||0);
        const base=await api('apiary_overview'); state.apiaryTechnical={...base};
        const seasonFilter=seasonId||base.season?.id||'';
        let page=''; let actions='';
        if(view==='inspections'){
            const d=await api('apiary_inspections_list',{params:{season_id:seasonFilter}});state.apiaryTechnical={...state.apiaryTechnical,...d};actions='<button class="btn btn-primary" data-command="apiary-inspection-new">+ Nueva inspección</button>';
            page=`<section class="technical-summary-grid"><article><small>Temporada</small><strong>${h(base.season?.name||'—')}</strong></article><article><small>Inspecciones</small><strong>${integerQty((base.summary||{}).inspections||0)}</strong></article><article><small>Cosecha registrada</small><strong>${Number((base.summary||{}).harvest_kg||0).toLocaleString('es-AR',{maximumFractionDigits:2})} kg</strong></article></section><section class="technical-card-grid">${(d.inspections||[]).length?(d.inspections||[]).map(x=>`<button class="technical-record-card inspection-card" data-command="apiary-inspection-edit" data-id="${x.id}"><div><span class="eyebrow">${formatDate(x.inspection_date)}</span><h3>${h(x.hive_name)}</h3></div><div class="inspection-quick-metrics"><span>Reina ${Number(x.queen_seen)?'✓':'—'}</span><span>Abejas ${integerQty(x.frames_bees||0)} c.</span><span>Miel ${h(capitalize(x.honey_reserve_status||'sin evaluar'))}</span><span>Polen ${h(capitalize(x.pollen_reserve_status||'sin evaluar'))}</span><span>Celdas ${integerQty(x.queen_cells||0)}</span></div><small>${x.file_count?`${integerQty(x.file_count)} archivos · `:''}${h(x.created_by_name||'')}</small></button>`).join(''):emptyState('◉','Todavía no hay inspecciones','Registre una visita para comenzar el historial técnico.')}</section>`;
        } else if(view==='harvests'){
            const d=await api('apiary_harvests_list',{params:{season_id:seasonFilter}});state.apiaryTechnical={...state.apiaryTechnical,...d};actions='<button class="btn btn-primary" data-command="apiary-harvest-new">+ Registrar cosecha</button>';
            page=`<section class="technical-card-grid harvest-grid">${(d.harvests||[]).length?d.harvests.map(x=>`<button class="technical-record-card harvest-card" data-command="apiary-harvest-edit" data-id="${x.id}"><span class="eyebrow">${formatDate(x.harvest_date)} · ${h(x.season_name||'')}</span><div class="harvest-total"><strong>${Number(x.total_kg||0).toLocaleString('es-AR',{maximumFractionDigits:3})}</strong><span>kg</span></div><h3>${h(x.batch_code||'Cosecha sin lote')}</h3><p>${h(x.honey_type||'Tipo de miel sin indicar')} · ${integerQty(x.hive_count||0)} colmenas</p>${x.moisture_pct?`<small>Humedad ${Number(x.moisture_pct).toLocaleString('es-AR')}%</small>`:''}</button>`).join(''):emptyState('⬢','No hay cosechas registradas','Registre una extracción para comenzar la trazabilidad de producción.')}</section>`;
        } else if(view==='health'){
            const d=await api('apiary_health_list',{params:{season_id:seasonFilter}});state.apiaryTechnical={...state.apiaryTechnical,...d};actions='<button class="btn btn-primary" data-command="apiary-health-new">+ Registro sanitario</button>';
            page=`<section class="technical-card-grid">${(d.records||[]).length?d.records.map(x=>`<button class="technical-record-card health-card" data-command="apiary-health-edit" data-id="${x.id}"><span class="eyebrow">${formatDate(x.record_date)}</span><h3>${h(x.condition_name||capitalize(x.treatment_type))}</h3><p>${h(x.product||'Sin producto')} ${x.dose?`· ${h(x.dose)}`:''}</p><div class="technical-chip-row">${(x.hives||[]).slice(0,4).map(v=>`<span>${h(v.hive_name)}</span>`).join('')}${Number(x.hive_count)>4?`<span>+${Number(x.hive_count)-4}</span>`:''}</div>${x.result?`<small>Resultado: ${h(x.result)}</small>`:''}</button>`).join(''):emptyState('✚','No hay registros sanitarios','Los tratamientos y controles quedarán asociados a cada colmena.')}</section>`;
        } else if(view==='feeding'){
            const d=await api('apiary_feedings_list',{params:{season_id:seasonFilter}});state.apiaryTechnical={...state.apiaryTechnical,...d};actions='<button class="btn btn-primary" data-command="apiary-feeding-new">+ Registrar alimentación</button>';
            page=`<section class="technical-card-grid">${(d.feedings||[]).length?d.feedings.map(x=>`<button class="technical-record-card feeding-card" data-command="apiary-feeding-edit" data-id="${x.id}"><span class="eyebrow">${formatDate(x.feeding_date)}</span><h3>${h(x.feed_type)}</h3><div class="feeding-amount"><strong>${Number(x.quantity_per_hive||0).toLocaleString('es-AR',{maximumFractionDigits:3})}</strong><span>${h(x.unit)} / colmena</span></div><p>${integerQty(x.hive_count||0)} colmenas${x.reason?` · ${h(x.reason)}`:''}</p></button>`).join(''):emptyState('◒','No hay alimentaciones','Registre jarabe, fondant o suplemento para conservar el historial.')}</section>`;
        } else if(view==='performance'){
            const d=await api('apiary_performance',{params:{season_id:seasonFilter}});state.apiaryTechnical={...state.apiaryTechnical,...d};const rows=d.rows||[];
            page=`<section class="performance-hero panel"><div><span class="eyebrow">TEMPORADA ${h(d.season?.name||'')}</span><h2>Comparación por colmena</h2><p>Producción, inspecciones, sanidad y alimentación sin inventar un puntaje: cada indicador queda visible por separado.</p></div><div class="performance-summary"><article><small>Miel cosechada</small><strong>${Number(d.summary?.harvest_kg||0).toLocaleString('es-AR',{maximumFractionDigits:2})} kg</strong></article><article><small>Inspecciones</small><strong>${integerQty(d.summary?.inspections||0)}</strong></article></div></section>${rows.length?`<div class="table-wrap panel"><table class="data-table performance-table"><thead><tr><th>Colmena</th><th>Miel</th><th>Inspecciones</th><th>Abejas prom.</th><th>Reserva miel</th><th>Reserva polen</th><th>Sanidad</th><th>Alimentación</th><th>Reinas</th></tr></thead><tbody>${rows.map(x=>`<tr><td><a href="#/hive/${x.id}"><strong>${h(x.name)}</strong></a><small>${x.last_inspection?`Última inspección ${formatDate(x.last_inspection)}`:'Sin inspecciones'}</small></td><td><strong>${Number(x.harvest_kg||0).toLocaleString('es-AR',{maximumFractionDigits:2})} kg</strong></td><td>${integerQty(x.inspections||0)}</td><td>${Number(x.avg_bees||0).toLocaleString('es-AR',{maximumFractionDigits:1})} c.</td><td>${h(capitalize(x.latest_honey_reserve||'—'))}</td><td>${h(capitalize(x.latest_pollen_reserve||'—'))}</td><td>${integerQty(x.health_events||0)}</td><td>${integerQty(x.feeding_events||0)}</td><td>${integerQty(x.queen_changes||0)}</td></tr>`).join('')}</tbody></table></div>`:emptyState('◫','Sin datos comparables','Las métricas aparecerán cuando registre inspecciones, cosechas, sanidad o alimentación.')}`;
        } else {
            const d=await api('apiary_seasons_list');state.apiaryTechnical={...state.apiaryTechnical,...d};actions='<button class="btn btn-primary" data-command="apiary-season-new">+ Nueva temporada</button>';
            page=`<section class="season-grid">${(d.seasons||[]).map(x=>`<article class="season-card ${Number(x.is_active)?'active':''}"><div><span class="eyebrow">${Number(x.is_active)?'TEMPORADA ACTIVA':'TEMPORADA'}</span><h2>${h(x.name)}</h2><p>${formatDate(x.start_date)} → ${formatDate(x.end_date)}</p></div><div class="season-metrics"><span><b>${integerQty(x.inspections)}</b> inspecciones</span><span><b>${Number(x.harvest_kg||0).toLocaleString('es-AR',{maximumFractionDigits:2})}</b> kg</span><span><b>${integerQty(x.health_records)}</b> sanidad</span><span><b>${integerQty(x.feedings)}</b> alimentación</span></div><div class="form-actions"><button class="btn btn-small btn-secondary" data-command="apiary-season-edit" data-id="${x.id}">Editar</button>${!Number(x.is_active)?`<button class="btn btn-small btn-ghost" data-command="apiary-season-activate" data-id="${x.id}">Activar</button><button class="icon-button danger" data-command="apiary-season-delete" data-id="${x.id}">×</button>`:''}</div></article>`).join('')}</section>`;
        }
        const filter=view==='seasons'?'':`<label class="field compact-field technical-season-filter"><span>Temporada</span><select data-command="apiary-season-filter" data-view="${view}">${(base.seasons||[]).map(x=>`<option value="${x.id}" ${String(x.id)===String(seasonFilter)?'selected':''}>${h(x.name)}</option>`).join('')}</select></label>`;
        shell({title:'Manejo',subtitle:'Seguimiento de las colmenas por temporada',active:'hives',actions:`<a class="btn btn-ghost" href="#/hives">← Colmenas</a>${filter}${actions}`,content:`${technicalTabs(view)}${page}`});hydrateProtectedImages();
    }

    async function route() {
        if (!state.token) {
            renderLogin();
            return;
        }
        const { path, params } = parseHash();
        try {
            await ensureNavigationOrder();
            if (path === '/' || path === '/dashboard') return await renderDashboard();
            if (path === '/hives') return await renderHives(params);
            if (path === '/technical') return await renderTechnical(params);
            if (/^\/hive\/\d+$/.test(path)) return await renderHive(Number(path.split('/')[2]));
            if (path === '/hive-edit') return await renderHiveEdit();
            if (/^\/hive-edit\/\d+$/.test(path)) return await renderHiveEdit(Number(path.split('/')[2]));
            if (path === '/materials') return await renderMaterials(params);
            if (path === '/activities') return await renderActivities(params);
            if (path === '/activity-edit') {
                await renderActivities(new URLSearchParams());
                return await openActivityModal(0, { hiveId: params.get('hive_id') || '' });
            }
            if (/^\/activity-edit\/\d+$/.test(path)) {
                await renderActivities(new URLSearchParams());
                return await openActivityModal(Number(path.split('/')[2]));
            }
            if (path === '/purchases') return await renderPurchases(params);
            if (/^\/purchase\/\d+$/.test(path)) return await renderPurchase(Number(path.split('/')[2]), params);
            if (path === '/accounting') return await renderAccounting(params);
            if (path === '/queen-rearing') return await renderQueenRearing(params);
            if (path === '/apiario-la-ruda') return await renderLaRuda(params);
            if (path === '/documents') return await renderDocuments(params);
            if (path === '/calendar') { go('/activities'); return; }
            if (path === '/backups') return await renderBackups();
            if (path === '/profile') return await renderProfile();
            go('/dashboard');
        } catch (error) {
            if (!state.token) return;
            shell({ title: 'No se pudo abrir', subtitle: 'Problema de conexión con el servidor local', active: '', content: `<section class="panel api-offline-box"><div class="empty-state"><div>!</div><h3>${h(error.message)}</h3><p>La interfaz está publicada, pero necesita que la computadora con Laragon y Cloudflare Tunnel esté encendida.</p><div class="inline-buttons"><button class="btn btn-primary" data-command="retry-route">Volver a intentar</button></div></div></section>` });
        }
    }

    document.addEventListener('input', event => {
        if (event.target.closest('[data-production-form]')) updateProductionPreview();
    });
    document.addEventListener('change', event => {
        if (event.target.closest('[data-production-form]')) updateProductionPreview();
        const seasonFilter = event.target.closest('[data-command="apiary-season-filter"]');
        if (seasonFilter) go('/technical', { view: seasonFilter.dataset.view, season_id: seasonFilter.value });
    });

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
            if (type === 'login') {
                const result = await api('login', { method: 'POST', noAuth: true, data: { username: form.elements.username.value, password: form.elements.password.value } });
                saveSession(result.token, result.user);
                if (!availableApps(result.user).includes('apicultura')) { if (availableApps(result.user).includes('ganaderia')) { window.location.href='ganaderia.html'; return; } if (availableApps(result.user).includes('comunidad')) { window.location.href='comunidad.html#/comunidad'; return; } }
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
                await api('apiculture_banner_upload', { method: 'POST', formData: new FormData(form) }); invalidateImageCache('apiculture_banner'); toast('Banner del inicio actualizado'); await route();
            } else if (type === 'hive-photo-upload') {
                await api('hive_photo_upload', { method: 'POST', formData: new FormData(form) }); invalidateImageCache('hive'); toast('Archivo agregado'); await route();
            } else if (type === 'material-filter') {
                const fd = new FormData(form); go('/materials', Object.fromEntries(fd.entries()));
            } else if (type === 'material-save') {
                await api('material_save', { method: 'POST', formData: new FormData(form) }); invalidateImageCache('material'); toast('Material guardado'); go('/materials');
            } else if (type === 'material-category-save') {
                await api('material_category_save', { method: 'POST', data: Object.fromEntries(new FormData(form).entries()) }); toast('Categoría guardada'); closeAppModal(); await renderMaterials(new URLSearchParams());
            } else if (type === 'apiary-inspection-save') {
                const fd=new FormData(form);const files=[...(form.elements.inspection_files?.files||[])];const payload=Object.fromEntries(fd.entries());payload.queen_seen=form.elements.queen_seen?.checked?1:0;payload.swarm_signs=form.elements.swarm_signs?.checked?1:0;delete payload.inspection_files;const r=await api('apiary_inspection_save',{method:'POST',data:payload});for(const file of files){const up=new FormData();up.set('inspection_id',r.id);up.set('file',file);await api('apiary_inspection_file_upload',{method:'POST',formData:up});}closeAppModal();toast('Inspección guardada');go('/technical',{view:'inspections'});
            } else if (type === 'apiary-inspection-file-upload') {
                await api('apiary_inspection_file_upload',{method:'POST',formData:new FormData(form)});invalidateImageCache('apiary_inspection');toast('Archivo agregado');await openInspectionModal({id:Number(form.elements.inspection_id.value)});
            } else if (type === 'apiary-harvest-save') {
                const fd=new FormData(form),payload=Object.fromEntries(fd.entries());payload.hive_ids=fd.getAll('hive_ids');payload.hive_kg={};payload.hive_ids.forEach(id=>payload.hive_kg[id]=Number(fd.get(`hive_kg_${id}`)||0));const r=await api('apiary_harvest_save',{method:'POST',data:payload});closeAppModal();toast(r.message);go('/technical',{view:'harvests'});
            } else if (type === 'apiary-health-save') {
                const fd=new FormData(form),payload=Object.fromEntries(fd.entries());payload.hive_ids=fd.getAll('hive_ids');const r=await api('apiary_health_save',{method:'POST',data:payload});closeAppModal();toast(r.message);go('/technical',{view:'health'});
            } else if (type === 'apiary-feeding-save') {
                const fd=new FormData(form),payload=Object.fromEntries(fd.entries());payload.hive_ids=fd.getAll('hive_ids');const r=await api('apiary_feeding_save',{method:'POST',data:payload});closeAppModal();toast(r.message);go('/technical',{view:'feeding'});
            } else if (type === 'apiary-season-save') {
                const payload=Object.fromEntries(new FormData(form).entries());payload.is_active=form.elements.is_active.checked?1:0;const r=await api('apiary_season_save',{method:'POST',data:payload});closeAppModal();toast(r.message);go('/technical',{view:'seasons'});
            } else if (type === 'activity-filter') {
                const fd = new FormData(form); go('/activities', Object.fromEntries(fd.entries()));
            } else if (type === 'activity-save') {
                const result = await api('activity_save', { method: 'POST', formData: new FormData(form) }); invalidateImageCache('activity'); toast(result.message); if (form.closest('.app-modal')) { closeAppModal(); go('/activities'); } else go(`/activity-edit/${result.id}`);
            } else if (type === 'activity-attachment-upload') {
                await api('activity_attachment_upload', { method: 'POST', formData: new FormData(form) }); invalidateImageCache('activity'); toast('Archivo agregado'); if (form.closest('.app-modal')) await openActivityModal(Number(form.elements.activity_id.value)); else await route();
            } else if (type === 'purchase-plan-save') {
                const result = await api('purchase_plan_save', { method: 'POST', data: Object.fromEntries(new FormData(form).entries()) }); toast(result.message); go(`/purchase/${result.id}`);
            } else if (type === 'purchase-item-save') {
                const fd = new FormData(form); const obj = Object.fromEntries(fd.entries()); obj.is_purchased = form.elements.is_purchased.checked ? 1 : 0; await api('purchase_item_save', { method: 'POST', data: obj }); toast('Renglón guardado'); go(`/purchase/${obj.plan_id}`);
            } else if (type === 'la-ruda-order-save') {
                const result=await api('la_ruda_order_save',{method:'POST',data:Object.fromEntries(new FormData(form).entries())});closeAppModal();toast(result.message);await renderLaRuda(new URLSearchParams());await openLaRudaOrder(result.id);
            } else if (type === 'la-ruda-item-save') {
                const orderId=Number(form.elements.order_id.value);await api('la_ruda_item_save',{method:'POST',data:Object.fromEntries(new FormData(form).entries())});toast('Producto agregado');await openLaRudaOrder(orderId);
            } else if (type === 'la-ruda-stock-adjust') {
                await api('la_ruda_stock_adjust',{method:'POST',data:Object.fromEntries(new FormData(form).entries())});closeAppModal();toast('Stock actualizado');await route();
            } else if (type === 'la-ruda-product-save') {
                const result=await api('la_ruda_product_save',{method:'POST',formData:new FormData(form)});invalidateImageCache('la_ruda_product');closeAppModal();toast(result.message);await route();
            } else if (type === 'la-ruda-model-save') {
                const result=await api('la_ruda_model_save',{method:'POST',formData:new FormData(form)});closeAppModal();toast(result.message);go('/apiario-la-ruda',{view:'modelos'});
            } else if (type === 'la-ruda-production-save') {
                const result=await api('la_ruda_production_save',{method:'POST',data:Object.fromEntries(new FormData(form).entries())});closeAppModal();toast(result.message);go('/apiario-la-ruda',{view:'fabricacion'});
            } else if (type === 'la-ruda-publish-save') {
                const payload=Object.fromEntries(new FormData(form).entries());payload.published_active=form.elements.published_active.checked?1:0;const result=await api('la_ruda_product_publish',{method:'POST',data:payload});closeAppModal();toast(result.message);go('/apiario-la-ruda',{view:'publicados'});
            } else if (type === 'la-ruda-sale-save') {
                const result=await api('la_ruda_sale_save',{method:'POST',data:Object.fromEntries(new FormData(form).entries())});closeAppModal();toast(result.message);go('/apiario-la-ruda',{view:'publicados'});
            } else if (type === 'accounting-filter') {
                go('/accounting', Object.fromEntries(new FormData(form).entries()));
            } else if (type === 'accounting-save') {
                await api('accounting_save', { method: 'POST', formData: new FormData(form) }); toast('Movimiento guardado'); go('/accounting');
            } else if (type === 'document-filter') {
                go('/documents', Object.fromEntries(new FormData(form).entries()));
            } else if (type === 'document-save') {
                const documentData = new FormData(form); documentData.set('app_code', 'apicultura'); await api('apiculture_document_save', { method:'POST', formData:documentData }); closeAppModal(); toast('Documento guardado'); go('/documents');
            } else if (type === 'queen-rearing-filter') {
                go('/queen-rearing', Object.fromEntries(new FormData(form).entries()));
            } else if (type === 'queen-rearing-save') {
                const result=await api('queen_rearing_save',{method:'POST',data:Object.fromEntries(new FormData(form).entries())});closeAppModal();toast(result.message||'Crianza guardada');go('/queen-rearing');
            } else if (type === 'queen-rearing-close') {
                const result=await api('queen_rearing_close',{method:'POST',data:Object.fromEntries(new FormData(form).entries())});closeAppModal();toast(`${result.message}${result.success_rate!==null&&result.success_rate!==undefined?` Efectividad: ${result.success_rate}%`:''}`);go('/queen-rearing');
            } else if (type === 'google-calendar-connect') {
                const result=await api('google_calendar_connect',{method:'POST',data:Object.fromEntries(new FormData(form).entries())});window.location.href=result.auth_url;return;
            } else if (type === 'google-calendar-settings') {
                await api('google_calendar_settings',{method:'POST',data:Object.fromEntries(new FormData(form).entries())});closeAppModal();toast('Avisos de Google Calendar guardados');await route();
            } else if (type === 'backup-restore') {
                if (!confirm('¿Restaurar esta copia? Los datos actuales serán reemplazados. Se generará primero un respaldo automático.')) return;
                await api('backup_restore', { method: 'POST', formData: new FormData(form) }); clearSession(); toast('Copia restaurada. Vuelva a ingresar.'); renderLogin();
            } else if (type === 'calendar-save') {
                await api('calendar_save', { method:'POST', data:Object.fromEntries(new FormData(form).entries()) }); closeAppModal(); toast('Evento guardado'); await route();
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
                if (target === 'comunidad' && canAccessApp('comunidad')) window.location.href = 'comunidad.html#/comunidad';
            } else if (command === 'apiary-season-filter') {
                go('/technical',{view:commandElement.dataset.view,season_id:commandElement.value});
            } else if (command === 'apiary-inspection-new') {
                await openInspectionModal({}, {hiveId:commandElement.dataset.hiveId||''});
            } else if (command === 'apiary-inspection-edit') {
                const row=(state.apiaryTechnical.inspections||[]).find(x=>String(x.id)===String(commandElement.dataset.id));if(row)await openInspectionModal(row);
            } else if (command === 'apiary-inspection-delete') {
                if(confirm('¿Eliminar esta inspección y sus archivos?')){await api('apiary_inspection_delete',{method:'POST',data:{id:commandElement.dataset.id}});invalidateImageCache('apiary_inspection');closeAppModal();toast('Inspección eliminada');go('/technical',{view:'inspections'});}
            } else if (command === 'apiary-inspection-file-delete') {
                if(confirm('¿Eliminar este archivo?')){await api('apiary_inspection_file_delete',{method:'POST',data:{id:commandElement.dataset.id}});invalidateImageCache('apiary_inspection');toast('Archivo eliminado');await openInspectionModal({id:Number(commandElement.dataset.inspectionId)});}
            } else if (command === 'apiary-harvest-new') {
                openHarvestModal();
            } else if (command === 'apiary-harvest-edit') {
                const row=(state.apiaryTechnical.harvests||[]).find(x=>String(x.id)===String(commandElement.dataset.id));if(row)openHarvestModal(row);
            } else if (command === 'apiary-harvest-delete') {
                if(confirm('¿Eliminar esta cosecha?')){await api('apiary_harvest_delete',{method:'POST',data:{id:commandElement.dataset.id}});closeAppModal();toast('Cosecha eliminada');go('/technical',{view:'harvests'});}
            } else if (command === 'apiary-health-new') {
                await openHealthModal({}, {hiveId:commandElement.dataset.hiveId||''});
            } else if (command === 'apiary-health-edit') {
                const row=(state.apiaryTechnical.records||[]).find(x=>String(x.id)===String(commandElement.dataset.id));if(row)await openHealthModal(row);
            } else if (command === 'apiary-health-delete') {
                if(confirm('¿Eliminar este registro sanitario?')){await api('apiary_health_delete',{method:'POST',data:{id:commandElement.dataset.id}});closeAppModal();toast('Registro eliminado');go('/technical',{view:'health'});}
            } else if (command === 'apiary-feeding-new') {
                await openFeedingModal({}, {hiveId:commandElement.dataset.hiveId||''});
            } else if (command === 'apiary-feeding-edit') {
                const row=(state.apiaryTechnical.feedings||[]).find(x=>String(x.id)===String(commandElement.dataset.id));if(row)await openFeedingModal(row);
            } else if (command === 'apiary-feeding-delete') {
                if(confirm('¿Eliminar este registro de alimentación?')){await api('apiary_feeding_delete',{method:'POST',data:{id:commandElement.dataset.id}});closeAppModal();toast('Registro eliminado');go('/technical',{view:'feeding'});}
            } else if (command === 'apiary-season-new') {
                openSeasonModal();
            } else if (command === 'apiary-season-edit') {
                const row=(state.apiaryTechnical.seasons||[]).find(x=>String(x.id)===String(commandElement.dataset.id));if(row)openSeasonModal(row);
            } else if (command === 'apiary-season-activate') {
                await api('apiary_season_activate',{method:'POST',data:{id:commandElement.dataset.id}});toast('Temporada activa actualizada');await route();
            } else if (command === 'apiary-season-delete') {
                if(confirm('¿Eliminar esta temporada? Los registros quedarán conservados sin temporada asignada.')){await api('apiary_season_delete',{method:'POST',data:{id:commandElement.dataset.id}});toast('Temporada eliminada');await route();}
            } else if (command === 'la-ruda-order-new') {
                openLaRudaOrderForm();
            } else if (command === 'la-ruda-order-open') {
                await openLaRudaOrder(Number(commandElement.dataset.id));
            } else if (command === 'la-ruda-order-edit') {
                const d=await api('la_ruda_order',{params:{id:commandElement.dataset.id}});openLaRudaOrderForm(d.order);
            } else if (command === 'la-ruda-order-status') {
                await api('la_ruda_order_status',{method:'POST',data:{id:commandElement.dataset.id,status:commandElement.dataset.status}});toast('Estado actualizado');await openLaRudaOrder(Number(commandElement.dataset.id));
            } else if (command === 'la-ruda-stage-toggle') {
                await api('la_ruda_stage_toggle',{method:'POST',data:{id:commandElement.dataset.id,completed:commandElement.dataset.completed}});toast('Etapa actualizada');await openLaRudaOrder(Number(commandElement.dataset.orderId));
            } else if (command === 'la-ruda-item-delete') {
                if(confirm('¿Quitar este producto del pedido?')){await api('la_ruda_item_delete',{method:'POST',data:{id:commandElement.dataset.id}});await openLaRudaOrder(Number(commandElement.dataset.orderId));}
            } else if (command === 'la-ruda-order-delete') {
                if(confirm('¿Eliminar el pedido completo?')){await api('la_ruda_order_delete',{method:'POST',data:{id:commandElement.dataset.id}});closeAppModal();toast('Pedido eliminado');go('/apiario-la-ruda');}
            } else if (command === 'la-ruda-stock-open') {
                const product=(state.laRudaData?.products||[]).find(x=>String(x.id)===String(commandElement.dataset.id));if(product)openLaRudaStock(product);
            } else if (command === 'la-ruda-product-open') {
                await openLaRudaProductHistory(Number(commandElement.dataset.id));
            } else if (command === 'la-ruda-product-delete') {
                if(confirm('¿Eliminar este producto del catálogo? El historial y los pedidos anteriores se conservarán.')){await api('la_ruda_product_delete',{method:'POST',data:{id:commandElement.dataset.id}});closeAppModal();toast('Producto eliminado');await route();}
            } else if (command === 'la-ruda-product-edit') {
                const data=await api('la_ruda_product_history',{params:{id:commandElement.dataset.id}});openLaRudaProductForm(data.product);
            } else if (command === 'la-ruda-production-new') {
                openLaRudaProductionForm(commandElement.dataset.id||'');
            } else if (command === 'la-ruda-production-stage-toggle') {
                await api('la_ruda_production_stage_toggle',{method:'POST',data:{id:commandElement.dataset.id,completed:commandElement.dataset.completed}});toast('Etapa actualizada');go('/apiario-la-ruda',{view:'fabricacion'});
            } else if (command === 'la-ruda-production-complete') {
                if(confirm('¿Confirmar la fabricación e ingresar las unidades y el costo al stock?')){const r=await api('la_ruda_production_complete',{method:'POST',data:{batch_id:commandElement.dataset.id}});toast(r.message);go('/apiario-la-ruda',{view:'fabricacion'});}
            } else if (command === 'la-ruda-production-delete') {
                if(confirm('¿Cancelar esta fabricación?')){const r=await api('la_ruda_production_delete',{method:'POST',data:{id:commandElement.dataset.id}});toast(r.message);go('/apiario-la-ruda',{view:'fabricacion'});}
            } else if (command === 'la-ruda-publish-open') {
                const product=(state.laRudaData?.products||[]).find(x=>String(x.id)===String(commandElement.dataset.id));if(product)openLaRudaPublish(product);
            } else if (command === 'la-ruda-sale-open') {
                const product=(state.laRudaData?.products||[]).find(x=>String(x.id)===String(commandElement.dataset.id));if(product)openLaRudaSale(product);
            } else if (command === 'la-ruda-model-new') {
                openLaRudaModelForm();
            } else if (command === 'la-ruda-model-edit') {
                const data=await api('la_ruda_model',{params:{id:commandElement.dataset.id}});openLaRudaModelForm(data.model);
            } else if (command === 'la-ruda-model-download') {
                await downloadBlob('file',{type:'la_ruda_3d_model',id:commandElement.dataset.id},commandElement.dataset.name||'modelo-3d');
            } else if (command === 'la-ruda-model-delete') {
                if(confirm('¿Eliminar este modelo 3D y su archivo?')){const result=await api('la_ruda_model_delete',{method:'POST',data:{id:commandElement.dataset.id}});toast(result.message);go('/apiario-la-ruda',{view:'modelos'});}
            } else if (command === 'la-ruda-product-new') {
                openLaRudaProductForm();
            } else if (command === 'banner-editor-toggle') {
                const editor = document.querySelector('[data-banner-editor]');
                if (editor) editor.hidden = !editor.hidden;
            } else if (command === 'logout') {
                try { await api('logout', { method: 'POST', data: {} }); } catch (_) {}
                clearSession(); renderLogin();
            } else if (command === 'retry-route') {
                await route();
            } else if (command === 'modal-close') {
                closeAppModal();
            } else if (command === 'nav-order-open') {
                openNavigationOrderEditor();
            } else if (command === 'nav-order-move') {
                const row=commandElement.closest('[data-nav-key]');const sibling=commandElement.dataset.direction==='up'?row?.previousElementSibling:row?.nextElementSibling;if(row&&sibling){if(commandElement.dataset.direction==='up')row.parentElement.insertBefore(row,sibling);else row.parentElement.insertBefore(sibling,row);}
            } else if (command === 'nav-order-reset') {
                {const box=document.createElement('div');box.innerHTML=navigationOrderRows(navItems);document.querySelector('[data-navigation-order-list]').innerHTML=box.querySelector('[data-navigation-order-list]').innerHTML;initNavigationOrderEditor();}
            } else if (command === 'nav-order-save') {
                const order=[...document.querySelectorAll('[data-navigation-order-list] [data-nav-key]')].map(row=>row.dataset.navKey);const result=await api('navigation_save',{method:'POST',data:{app_code:'apicultura',order}});state.navigationOrder=result.order;closeAppModal();toast('Orden personal guardado');await route();
            } else if (command === 'activity-archive-open') {
                openArchivedActivities();
            } else if (command === 'activity-open') {
                await openActivityModal(Number(commandElement.dataset.id || 0), { hiveId: commandElement.dataset.hiveId || '' });
            } else if (command === 'google-calendar-open') {
                await openGoogleCalendarModal('apicultura');
            } else if (command === 'google-calendar-sync') {
                const result=await api('google_calendar_sync',{method:'POST',data:{app_code:commandElement.dataset.app||'apicultura'}});toast(result.message);closeAppModal();await route();
            } else if (command === 'google-calendar-disconnect') {
                if(!confirm('¿Desconectar Google Calendar de esta aplicación?'))return;await api('google_calendar_disconnect',{method:'POST',data:{app_code:commandElement.dataset.app||'apicultura'}});closeAppModal();toast('Google Calendar desconectado');await route();
            } else if (command === 'calendar-new') {
                openCalendarModal({ start: commandElement.dataset.date || today() });
            } else if (command === 'calendar-edit') {
                openCalendarModal({ id:commandElement.dataset.id,title:commandElement.dataset.title,type:commandElement.dataset.type,start:commandElement.dataset.start,end:commandElement.dataset.end,notes:commandElement.dataset.notes });
            } else if (command === 'calendar-delete') {
                await api('calendar_delete',{method:'POST',data:{id:commandElement.dataset.id,app_code:'apicultura'}}); closeAppModal(); toast('Evento eliminado'); await route();
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
                await api('hive_photo_cover', { method: 'POST', data: { id: commandElement.dataset.id, hive_id: commandElement.dataset.hiveId } }); invalidateImageCache('hive'); toast('Banner de la colmena actualizado'); await route();
            } else if (command === 'hive-photo-delete') {
                if (!confirm('¿Eliminar este archivo?')) return;
                await api('hive_photo_delete', { method: 'POST', data: { id: commandElement.dataset.id, hive_id: commandElement.dataset.hiveId } }); invalidateImageCache('hive'); toast('Archivo eliminado'); await route();
            } else if (command === 'apiculture-banner-delete') {
                if (!confirm('¿Quitar la imagen del inicio?')) return;
                await api('apiculture_banner_delete', { method: 'POST', data: {} }); invalidateImageCache('apiculture_banner'); toast('Banner eliminado'); await route();
            } else if (command === 'material-categories-open') {
                openMaterialCategories();
            } else if (command === 'material-category-delete') {
                if (!confirm('¿Eliminar esta categoría vacía?')) return;
                await api('material_category_delete', { method: 'POST', data: { id: commandElement.dataset.id } }); toast('Categoría eliminada'); closeAppModal(); await renderMaterials(new URLSearchParams());
            } else if (command === 'material-delete') {
                if (!confirm('¿Eliminar este material?')) return;
                await api('material_delete', { method: 'POST', data: { id: commandElement.dataset.id } }); toast('Material eliminado'); await route();
            } else if (command === 'activity-delete') {
                if (!confirm('¿Eliminar esta actividad y sus archivos?')) return;
                await api('activity_delete', { method: 'POST', data: { id: commandElement.dataset.id } }); toast('Actividad eliminada'); closeAppModal(); go('/activities');
            } else if (command === 'activity-attachment-delete') {
                if (!confirm('¿Eliminar este archivo?')) return;
                await api('activity_attachment_delete', { method: 'POST', data: { id: commandElement.dataset.id, activity_id: commandElement.dataset.activityId } }); toast('Archivo eliminado'); if (document.querySelector('.app-modal')) await openActivityModal(Number(commandElement.dataset.activityId)); else await route();
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
            } else if (command === 'document-new') {
                openDocumentModal('apicultura');
            } else if (command === 'document-edit') {
                openDocumentModal('apicultura',(state.managementDocuments||[]).find(x=>String(x.id)===String(commandElement.dataset.id))||{});
            } else if (command === 'document-open') {
                await openManagedDocument('apicultura',commandElement.dataset.id,commandElement.dataset.name);
            } else if (command === 'document-delete') {
                if(!confirm('¿Eliminar este documento y su archivo?'))return;await api('apiculture_document_delete',{method:'POST',data:{id:commandElement.dataset.id}});toast('Documento eliminado');await route();
            } else if (command === 'queen-rearing-new') {
                openQueenRearingModal();
            } else if (command === 'queen-rearing-edit') {
                openQueenRearingModal((state.queenRearingBatches||[]).find(x=>String(x.id)===String(commandElement.dataset.id))||{});
            } else if (command === 'queen-rearing-close') {
                const item=(state.queenRearingBatches||[]).find(x=>String(x.id)===String(commandElement.dataset.id));if(item)openQueenRearingClose(item);
            } else if (command === 'queen-rearing-delete') {
                if(!confirm('¿Eliminar este registro y su evento automático del calendario?'))return;await api('queen_rearing_delete',{method:'POST',data:{app_code:'apicultura',id:commandElement.dataset.id}});toast('Registro eliminado');await route();
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
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeAppModal(); });

    async function init() {
        const query=new URLSearchParams(window.location.search);const googleResult=query.get('google');
        if(googleResult){history.replaceState({},document.title,window.location.pathname+window.location.hash);setTimeout(()=>toast(googleResult==='connected'?'Google Calendar conectado correctamente':(query.get('google_message')||'No se pudo conectar Google Calendar'),googleResult==='connected'?'success':'error'),300);}
        if (!state.token) {
            renderLogin();
            return;
        }
        try {
            const result = await api('me');
            state.user = result.user;
            localStorage.setItem(STORAGE.user, JSON.stringify(state.user));
            if (!canAccessApp('apicultura')) { if (canAccessApp('ganaderia')) { window.location.href='ganaderia.html'; return; } if (canAccessApp('comunidad')) { window.location.href='comunidad.html#/comunidad'; return; } }
            if (!location.hash) location.hash = '#/dashboard'; else await route();
        } catch (_) {
            clearSession();
            renderLogin();
        }
    }

    init();
})();
