<?php
declare(strict_types=1);

require_once __DIR__ . '/db.php';

function e(?string $value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function is_https_request(): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    $forwardedProto = strtolower(trim(explode(',', (string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0] ?? ''));
    if ($forwardedProto === 'https') {
        return true;
    }
    $cfVisitor = (string)($_SERVER['HTTP_CF_VISITOR'] ?? '');
    return str_contains($cfVisitor, 'https');
}

function start_secure_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    $baseUrl = rtrim((string)app_config()['base_url'], '/');
    $cookiePath = $baseUrl === '' ? '/' : $baseUrl . '/';

    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_samesite', 'Lax');
    session_name('APICULTURA_SESSION');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => $cookiePath,
        'domain' => '',
        'secure' => is_https_request(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

start_secure_session();

function url(string $path = ''): string
{
    $base = rtrim((string)app_config()['base_url'], '/');
    if ($path === '') {
        return $base === '' ? '/' : $base;
    }
    return $base . '/' . ltrim($path, '/');
}

function route(string $page, array $params = []): string
{
    return url('index.php') . '?' . http_build_query(array_merge(['page' => $page], $params));
}

function redirect(string $target): never
{
    header('Location: ' . $target);
    exit;
}

function current_request_uri(): string
{
    $uri = (string)($_SERVER['REQUEST_URI'] ?? url('index.php'));
    return safe_internal_url($uri, url('index.php'));
}

function safe_internal_url(string $candidate, string $fallback): string
{
    if ($candidate === '' || str_contains($candidate, "\r") || str_contains($candidate, "\n")) {
        return $fallback;
    }

    $parts = parse_url($candidate);
    if ($parts === false || isset($parts['scheme']) || isset($parts['host'])) {
        return $fallback;
    }

    $base = rtrim((string)app_config()['base_url'], '/');
    $path = (string)($parts['path'] ?? '');
    if ($base !== '' && !str_starts_with($path, $base . '/') && $path !== $base) {
        return $fallback;
    }
    if ($base === '' && !str_starts_with($path, '/')) {
        return $fallback;
    }

    return $candidate;
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return (string)$_SESSION['csrf_token'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf_token" value="' . e(csrf_token()) . '">';
}

function verify_csrf(): void
{
    $token = $_POST['csrf_token'] ?? ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if (!is_string($token) || !hash_equals(csrf_token(), $token)) {
        http_response_code(419);
        exit('Solicitud vencida o inválida. Vuelva a cargar la página.');
    }
}

function flash(string $type, string $message): void
{
    $_SESSION['flash'][] = ['type' => $type, 'message' => $message];
}

function consume_flashes(): array
{
    $flashes = $_SESSION['flash'] ?? [];
    unset($_SESSION['flash']);
    return is_array($flashes) ? $flashes : [];
}

function get_int(string $key, int $default = 0): int
{
    $value = filter_input(INPUT_GET, $key, FILTER_VALIDATE_INT);
    return $value === false || $value === null ? $default : (int)$value;
}

function post_int(string $key, ?int $default = null): ?int
{
    $value = $_POST[$key] ?? null;
    if ($value === '' || $value === null) {
        return $default;
    }
    $filtered = filter_var($value, FILTER_VALIDATE_INT);
    return $filtered === false ? $default : (int)$filtered;
}

function post_decimal(string $key, float $default = 0.0): float
{
    $value = trim((string)($_POST[$key] ?? ''));
    if ($value === '') {
        return $default;
    }
    $value = preg_replace('/[^0-9,.-]/', '', $value) ?? '';
    $lastComma = strrpos($value, ',');
    $lastDot = strrpos($value, '.');
    if ($lastComma !== false && $lastDot !== false) {
        if ($lastComma > $lastDot) {
            $value = str_replace('.', '', $value);
            $value = str_replace(',', '.', $value);
        } else {
            $value = str_replace(',', '', $value);
        }
    } elseif ($lastComma !== false) {
        $value = str_replace('.', '', $value);
        $value = str_replace(',', '.', $value);
    }
    return is_numeric($value) ? (float)$value : $default;
}

function money_ars(float|int|string|null $value): string
{
    return '$ ' . number_format((float)$value, 2, ',', '.');
}

function money_usd(float|int|string|null $value): string
{
    return 'USD ' . number_format((float)$value, 2, ',', '.');
}

function format_date(?string $date): string
{
    if (!$date) {
        return '—';
    }
    return (new DateTime($date))->format('d/m/Y');
}

function format_datetime(?string $date): string
{
    if (!$date) {
        return '—';
    }
    return (new DateTime($date))->format('d/m/Y H:i');
}

function month_label(string $date): string
{
    $months = [1 => 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    $dt = new DateTime($date);
    return ucfirst($months[(int)$dt->format('n')]) . ' ' . $dt->format('Y');
}

function table_exists(string $table): bool
{
    // INFORMATION_SCHEMA funciona de forma confiable con consultas preparadas
    // y evita incompatibilidades de MariaDB/MySQL con SHOW TABLES LIKE ?.
    try {
        $stmt = db()->prepare(
            'SELECT COUNT(*)
'
            . 'FROM information_schema.tables
'
            . 'WHERE table_schema = DATABASE() AND table_name = ?'
        );
        $stmt->execute([$table]);
        return (int)$stmt->fetchColumn() > 0;
    } catch (Throwable) {
        return false;
    }
}

function column_exists(string $table, string $column): bool
{
    try {
        $stmt = db()->prepare(
            'SELECT COUNT(*) FROM information_schema.columns '
            . 'WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?'
        );
        $stmt->execute([$table, $column]);
        return (int)$stmt->fetchColumn() > 0;
    } catch (Throwable) {
        return false;
    }
}

function index_exists(string $table, string $index): bool
{
    try {
        $stmt = db()->prepare(
            'SELECT COUNT(*) FROM information_schema.statistics '
            . 'WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?'
        );
        $stmt->execute([$table, $index]);
        return (int)$stmt->fetchColumn() > 0;
    } catch (Throwable) {
        return false;
    }
}

/**
 * Mantiene compatible una instalación ya existente al copiar una versión nueva.
 * Es idempotente: puede ejecutarse en cada petición sin duplicar columnas ni datos.
 */
function ensure_app_schema(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    if (table_exists('users')) {
        if (!column_exists('users', 'app_code')) {
            db()->exec("ALTER TABLE users ADD COLUMN app_code VARCHAR(40) NOT NULL DEFAULT 'apicultura' AFTER display_name");
        }
        if (!column_exists('users', 'role')) {
            db()->exec("ALTER TABLE users ADD COLUMN role VARCHAR(40) NOT NULL DEFAULT 'usuario' AFTER app_code");
        }
        if (!column_exists('users', 'notification_email')) {
            db()->exec("ALTER TABLE users ADD COLUMN notification_email VARCHAR(190) NULL AFTER role");
        }
        execute_sql("UPDATE users SET app_code='apicultura' WHERE app_code IS NULL OR app_code=''", []);

        db()->exec(
            "CREATE TABLE IF NOT EXISTS user_app_access (
                user_id INT UNSIGNED NOT NULL,
                app_code VARCHAR(40) NOT NULL,
                granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, app_code),
                INDEX idx_user_app_access_app (app_code),
                CONSTRAINT fk_user_app_access_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
        execute_sql("INSERT IGNORE INTO user_app_access (user_id, app_code) SELECT id, app_code FROM users WHERE active=1");
        execute_sql("INSERT IGNORE INTO user_app_access (user_id, app_code) SELECT id, 'ganaderia' FROM users WHERE LOWER(username)='chiara' AND active=1");
    }

    if (table_exists('purchase_plans')) {
        if (!column_exists('purchase_plans', 'status')) {
            db()->exec("ALTER TABLE purchase_plans ADD COLUMN status ENUM('pendiente','realizada') NOT NULL DEFAULT 'pendiente' AFTER notes");
        }
        if (!column_exists('purchase_plans', 'completed_at')) {
            db()->exec('ALTER TABLE purchase_plans ADD COLUMN completed_at DATETIME NULL AFTER status');
        }
        if (!column_exists('purchase_plans', 'materials_generated_at')) {
            db()->exec('ALTER TABLE purchase_plans ADD COLUMN materials_generated_at DATETIME NULL AFTER completed_at');
        }
        if (!index_exists('purchase_plans', 'idx_purchase_plans_status')) {
            db()->exec('ALTER TABLE purchase_plans ADD INDEX idx_purchase_plans_status (status)');
        }
    }
    if (table_exists('materials') && !column_exists('materials', 'category')) {
        db()->exec("ALTER TABLE materials ADD COLUMN category VARCHAR(100) NOT NULL DEFAULT 'Otros materiales' AFTER name");
        execute_sql("UPDATE materials SET category=CASE
            WHEN LOWER(name) LIKE '%cuadro%' OR LOWER(name) LIKE '%marco%' THEN 'Cuadros y marcos'
            WHEN LOWER(name) LIKE '%alza%' OR LOWER(name) LIKE '%caja%' THEN 'Alzas y cajas'
            WHEN LOWER(name) LIKE '%techo%' OR LOWER(name) LIKE '%piso%' OR LOWER(name) LIKE '%entretapa%' THEN 'Techos, pisos y tapas'
            WHEN LOWER(name) LIKE '%nucleo%' OR LOWER(name) LIKE '%núcleo%' THEN 'Núcleos'
            WHEN LOWER(name) LIKE '%aliment%' OR LOWER(name) LIKE '%jarabe%' THEN 'Alimentación'
            WHEN LOWER(name) LIKE '%guante%' OR LOWER(name) LIKE '%careta%' OR LOWER(name) LIKE '%traje%' THEN 'Indumentaria'
            WHEN LOWER(name) LIKE '%acido%' OR LOWER(name) LIKE '%ácido%' OR LOWER(name) LIKE '%medic%' THEN 'Sanidad y tratamientos'
            WHEN LOWER(name) LIKE '%pinza%' OR LOWER(name) LIKE '%palanca%' OR LOWER(name) LIKE '%ahumador%' OR LOWER(name) LIKE '%herramient%' THEN 'Herramientas'
            ELSE 'Otros materiales' END");
    }
    if (table_exists('materials') && !index_exists('materials', 'idx_materials_category')) {
        db()->exec('ALTER TABLE materials ADD INDEX idx_materials_category (category)');
    }
    if (table_exists('materials') && !column_exists('materials', 'photo_original_name')) db()->exec('ALTER TABLE materials ADD COLUMN photo_original_name VARCHAR(255) NULL AFTER category');
    if (table_exists('materials') && !column_exists('materials', 'photo_relative_path')) db()->exec('ALTER TABLE materials ADD COLUMN photo_relative_path VARCHAR(500) NULL AFTER photo_original_name');
    if (table_exists('materials') && !column_exists('materials', 'photo_mime_type')) db()->exec('ALTER TABLE materials ADD COLUMN photo_mime_type VARCHAR(100) NULL AFTER photo_relative_path');
    db()->exec("CREATE TABLE IF NOT EXISTS material_categories (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,name VARCHAR(100) NOT NULL,sort_order INT NOT NULL DEFAULT 100,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY uk_material_categories_name (name),INDEX idx_material_categories_order (sort_order,name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    execute_sql("INSERT IGNORE INTO material_categories (name) VALUES ('Otros materiales')");
    if (table_exists('materials')) execute_sql("INSERT IGNORE INTO material_categories (name) SELECT DISTINCT category FROM materials WHERE category IS NOT NULL AND TRIM(category)<>''");
    if (table_exists('materials') && !column_exists('materials', 'source_purchase_plan_id')) {
        db()->exec('ALTER TABLE materials ADD COLUMN source_purchase_plan_id INT UNSIGNED NULL AFTER notes');
    }
    if (table_exists('materials') && !column_exists('materials', 'source_purchase_item_id')) {
        db()->exec('ALTER TABLE materials ADD COLUMN source_purchase_item_id INT UNSIGNED NULL AFTER source_purchase_plan_id');
    }

    if (table_exists('activity_statuses') && table_exists('activities')) {
        $pending = query_one("SELECT id FROM activity_statuses WHERE slug='pendientes' LIMIT 1");
        $shopping = query_one("SELECT id FROM activity_statuses WHERE slug='compras' LIMIT 1");
        if ($pending && $shopping) {
            execute_sql('UPDATE activities SET status_id=? WHERE status_id=?', [(int)$pending['id'], (int)$shopping['id']]);
            execute_sql('DELETE FROM activity_statuses WHERE id=?', [(int)$shopping['id']]);
        }
        execute_sql("UPDATE activity_statuses SET sort_order=30 WHERE slug='terminadas'");
    }

    // Personalización visual apícola e historial de reinas (v8).
    db()->exec(
        "CREATE TABLE IF NOT EXISTS apiculture_banner (
            id TINYINT UNSIGNED PRIMARY KEY,
            original_name VARCHAR(255) NULL,
            relative_path VARCHAR(500) NULL,
            mime_type VARCHAR(100) NULL,
            caption VARCHAR(255) NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    execute_sql("INSERT IGNORE INTO apiculture_banner (id, caption) VALUES (1, 'Vista general del apiario')");

    if (table_exists('hives') && !column_exists('hives', 'cover_photo_id')) {
        db()->exec('ALTER TABLE hives ADD COLUMN cover_photo_id INT UNSIGNED NULL AFTER queen_year');
    }
    if (table_exists('hives') && !index_exists('hives', 'idx_hives_cover_photo')) {
        db()->exec('ALTER TABLE hives ADD INDEX idx_hives_cover_photo (cover_photo_id)');
    }

    db()->exec(
        "CREATE TABLE IF NOT EXISTS hive_queen_history (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            hive_id INT UNSIGNED NOT NULL,
            queen_year SMALLINT UNSIGNED NOT NULL,
            change_date DATE NOT NULL,
            notes TEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_hive_queen_history_hive FOREIGN KEY (hive_id) REFERENCES hives(id) ON DELETE CASCADE,
            INDEX idx_hive_queen_history_date (hive_id, change_date, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    execute_sql(
        "INSERT INTO hive_queen_history (hive_id, queen_year, change_date, notes)
         SELECT h.id, h.queen_year, CONCAT(h.queen_year, '-01-01'), 'Registro inicial migrado'
         FROM hives h
         WHERE h.queen_year IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM hive_queen_history q WHERE q.hive_id=h.id)"
    );

    ensure_livestock_schema();
    ensure_community_schema();
    ensure_management_calendar_schema();
    ensure_shared_management_schema();
    ensure_google_calendar_schema();
    ensure_la_ruda_schema();
    ensure_apiculture_management_schema();
}

function ensure_livestock_schema(): void
{
    if (!table_exists('users')) {
        return;
    }

    $statements = [
        "CREATE TABLE IF NOT EXISTS livestock_parcels (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(140) NOT NULL, area_ha DECIMAL(12,2) NULL, status ENUM('disponible','en_uso','descanso','problema') NOT NULL DEFAULT 'disponible', rest_start DATE NULL, rest_end DATE NULL, fence_status ENUM('bien','revisar','reparar') NOT NULL DEFAULT 'bien', water_status ENUM('disponible','limitada','sin_agua') NOT NULL DEFAULT 'disponible', animal_capacity INT UNSIGNED NULL, pasture_type VARCHAR(180) NULL, pasture_variety VARCHAR(180) NULL, pasture_stage ENUM('sin_pastura','implantacion','crecimiento','vegetativo','floracion','semillado','pastoreo','recuperacion','descanso','degradada') NOT NULL DEFAULT 'sin_pastura', pasture_condition ENUM('excelente','buena','regular','mala') NULL, pasture_last_update DATE NULL, pasture_expected_flowering DATE NULL, pasture_grazing_start DATE NULL, pasture_grazing_end DATE NULL, recommended_rest_days INT UNSIGNED NULL, pasture_notes TEXT NULL, notes TEXT NULL, cover_original_name VARCHAR(255) NULL, cover_relative_path VARCHAR(500) NULL, cover_mime_type VARCHAR(100) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uk_livestock_parcels_name (name), INDEX idx_livestock_parcels_status (status), INDEX idx_livestock_parcels_pasture_stage (pasture_stage)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_field_banner (id TINYINT UNSIGNED PRIMARY KEY, original_name VARCHAR(255) NULL, relative_path VARCHAR(500) NULL, mime_type VARCHAR(100) NULL, caption VARCHAR(255) NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_pastures (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, parcel_id INT UNSIGNED NOT NULL, name VARCHAR(160) NOT NULL, variety VARCHAR(180) NULL, stage ENUM('implantacion','crecimiento','vegetativo','floracion','semillado','pastoreo','recuperacion','descanso','degradada') NOT NULL DEFAULT 'crecimiento', pasture_condition ENUM('excelente','buena','regular','mala') NULL, last_update DATE NULL, expected_flowering DATE NULL, grazing_start DATE NULL, grazing_end DATE NULL, recommended_rest_days INT UNSIGNED NULL, notes TEXT NULL, active TINYINT(1) NOT NULL DEFAULT 1, legacy_import TINYINT(1) NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_livestock_pastures_parcel FOREIGN KEY (parcel_id) REFERENCES livestock_parcels(id) ON DELETE CASCADE, INDEX idx_livestock_pastures_parcel (parcel_id,active), INDEX idx_livestock_pastures_stage (stage)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_categories (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, slug VARCHAR(110) NOT NULL, color VARCHAR(20) NOT NULL DEFAULT '#64748b', description TEXT NULL, market_group TINYINT(1) NOT NULL DEFAULT 0, active TINYINT(1) NOT NULL DEFAULT 1, sort_order INT NOT NULL DEFAULT 100, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uk_livestock_categories_name (name), UNIQUE KEY uk_livestock_categories_slug (slug), INDEX idx_livestock_categories_active_sort (active,sort_order)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_cattle (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, tag_number VARCHAR(80) NOT NULL, name VARCHAR(120) NULL, sex ENUM('hembra','macho') NOT NULL DEFAULT 'hembra', category VARCHAR(100) NULL, category_id INT UNSIGNED NULL, breed VARCHAR(120) NULL, birth_date DATE NULL, entry_date DATE NOT NULL, status ENUM('activo','vendido','muerto','retirado') NOT NULL DEFAULT 'activo', parcel_id INT UNSIGNED NULL, weight_kg DECIMAL(10,2) NULL, body_condition_score DECIMAL(3,1) NULL, body_condition_date DATE NULL, market_status ENUM('no','observacion','seleccionado','listo') NOT NULL DEFAULT 'no', market_date DATE NULL, notes TEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uk_livestock_cattle_tag (tag_number), CONSTRAINT fk_livestock_cattle_parcel FOREIGN KEY (parcel_id) REFERENCES livestock_parcels(id) ON DELETE SET NULL, CONSTRAINT fk_livestock_cattle_category FOREIGN KEY (category_id) REFERENCES livestock_categories(id) ON DELETE SET NULL, INDEX idx_livestock_cattle_status (status), INDEX idx_livestock_cattle_parcel (parcel_id), INDEX idx_livestock_cattle_category (category_id), INDEX idx_livestock_cattle_market (market_status), INDEX idx_livestock_cattle_body_condition (body_condition_score)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_cattle_notes (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cattle_id INT UNSIGNED NOT NULL, note_date DATE NOT NULL, note TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_livestock_notes_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE, INDEX idx_livestock_notes_date (cattle_id, note_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_cattle_photos (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cattle_id INT UNSIGNED NOT NULL, original_name VARCHAR(255) NOT NULL, relative_path VARCHAR(500) NOT NULL, mime_type VARCHAR(100) NOT NULL, size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0, caption VARCHAR(255) NULL, uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_livestock_photos_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE, INDEX idx_livestock_photos_cattle (cattle_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_health_records (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cattle_id INT UNSIGNED NOT NULL, batch_id INT UNSIGNED NULL, record_date DATE NOT NULL, record_type ENUM('vacunacion','tratamiento','control','enfermedad','servicio','parto','desparasitacion','revision_reproductiva','vaca_prenada','inseminacion','otro') NOT NULL DEFAULT 'control', description TEXT NOT NULL, product VARCHAR(180) NULL, dose VARCHAR(100) NULL, professional VARCHAR(160) NULL, next_date DATE NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_livestock_health_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE, INDEX idx_livestock_health_date (cattle_id, record_date), INDEX idx_livestock_health_next (next_date), INDEX idx_livestock_health_batch (batch_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_health_batches (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, record_date DATE NOT NULL, record_type ENUM('vacunacion','tratamiento','control','enfermedad','servicio','parto','desparasitacion','revision_reproductiva','vaca_prenada','inseminacion','otro') NOT NULL DEFAULT 'control', description TEXT NOT NULL, product VARCHAR(180) NULL, dose VARCHAR(100) NULL, professional VARCHAR(160) NULL, next_date DATE NULL, category_id INT UNSIGNED NULL, scope_label VARCHAR(255) NULL, animal_count INT UNSIGNED NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_livestock_health_batch_category FOREIGN KEY (category_id) REFERENCES livestock_categories(id) ON DELETE SET NULL, INDEX idx_livestock_health_batches_date (record_date), INDEX idx_livestock_health_batches_category (category_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_health_batch_cattle (batch_id INT UNSIGNED NOT NULL, cattle_id INT UNSIGNED NOT NULL, health_record_id INT UNSIGNED NOT NULL, PRIMARY KEY (batch_id,cattle_id), CONSTRAINT fk_livestock_batch_cattle_batch FOREIGN KEY (batch_id) REFERENCES livestock_health_batches(id) ON DELETE CASCADE, CONSTRAINT fk_livestock_batch_cattle_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE, CONSTRAINT fk_livestock_batch_cattle_record FOREIGN KEY (health_record_id) REFERENCES livestock_health_records(id) ON DELETE CASCADE, INDEX idx_livestock_batch_cattle_record (health_record_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_health_attachments (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, health_record_id INT UNSIGNED NULL, batch_id INT UNSIGNED NULL, original_name VARCHAR(255) NOT NULL, relative_path VARCHAR(500) NOT NULL, mime_type VARCHAR(100) NOT NULL, size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0, caption VARCHAR(255) NULL, uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_livestock_health_attachment_record FOREIGN KEY (health_record_id) REFERENCES livestock_health_records(id) ON DELETE CASCADE, CONSTRAINT fk_livestock_health_attachment_batch FOREIGN KEY (batch_id) REFERENCES livestock_health_batches(id) ON DELETE CASCADE, INDEX idx_livestock_health_attachment_record (health_record_id), INDEX idx_livestock_health_attachment_batch (batch_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_body_condition_records (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cattle_id INT UNSIGNED NOT NULL, assessment_date DATE NOT NULL, score DECIMAL(3,1) NOT NULL, notes TEXT NULL, is_alert TINYINT(1) NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_livestock_body_condition_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE, INDEX idx_livestock_body_condition_date (cattle_id,assessment_date), INDEX idx_livestock_body_condition_alert (is_alert,assessment_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_cattle_characteristics (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cattle_id INT UNSIGNED NOT NULL, record_date DATE NOT NULL, weight_kg DECIMAL(10,2) NULL, body_condition_score DECIMAL(3,1) NULL, notes TEXT NULL, source_body_condition_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_livestock_characteristics_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE, UNIQUE KEY uk_livestock_characteristics_source (source_body_condition_id), INDEX idx_livestock_characteristics_date (cattle_id,record_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_movements (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cattle_id INT UNSIGNED NOT NULL, from_parcel_id INT UNSIGNED NULL, to_parcel_id INT UNSIGNED NULL, movement_date DATE NOT NULL, reason VARCHAR(255) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_livestock_movements_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE, CONSTRAINT fk_livestock_movements_from FOREIGN KEY (from_parcel_id) REFERENCES livestock_parcels(id) ON DELETE SET NULL, CONSTRAINT fk_livestock_movements_to FOREIGN KEY (to_parcel_id) REFERENCES livestock_parcels(id) ON DELETE SET NULL, INDEX idx_livestock_movements_date (cattle_id, movement_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_activity_statuses (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL, slug VARCHAR(50) NOT NULL, sort_order INT NOT NULL DEFAULT 0, color VARCHAR(20) NOT NULL DEFAULT '#64748b', is_closed TINYINT(1) NOT NULL DEFAULT 0, UNIQUE KEY uk_livestock_activity_status_slug (slug)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_activity_labels (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL, color VARCHAR(20) NOT NULL DEFAULT '#f4b942', UNIQUE KEY uk_livestock_activity_label_name (name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_activities (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, title VARCHAR(180) NOT NULL, description TEXT NULL, cattle_id INT UNSIGNED NULL, parcel_id INT UNSIGNED NULL, status_id INT UNSIGNED NOT NULL, label_id INT UNSIGNED NULL, priority ENUM('baja','normal','alta','urgente') NOT NULL DEFAULT 'normal', due_date DATE NULL, position INT NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, completed_at DATETIME NULL, CONSTRAINT fk_livestock_activities_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE SET NULL, CONSTRAINT fk_livestock_activities_parcel FOREIGN KEY (parcel_id) REFERENCES livestock_parcels(id) ON DELETE SET NULL, CONSTRAINT fk_livestock_activities_status FOREIGN KEY (status_id) REFERENCES livestock_activity_statuses(id), CONSTRAINT fk_livestock_activities_label FOREIGN KEY (label_id) REFERENCES livestock_activity_labels(id) ON DELETE SET NULL, INDEX idx_livestock_activities_status_position (status_id, position), INDEX idx_livestock_activities_due (due_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_activity_attachments (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, activity_id INT UNSIGNED NOT NULL, original_name VARCHAR(255) NOT NULL, relative_path VARCHAR(500) NOT NULL, mime_type VARCHAR(100) NOT NULL, size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0, uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_livestock_attachment_activity FOREIGN KEY (activity_id) REFERENCES livestock_activities(id) ON DELETE CASCADE, INDEX idx_livestock_attachment_activity (activity_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_activity_logs (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, activity_id INT UNSIGNED NOT NULL, action VARCHAR(120) NOT NULL, details TEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_livestock_logs_activity FOREIGN KEY (activity_id) REFERENCES livestock_activities(id) ON DELETE CASCADE, INDEX idx_livestock_logs_date (activity_id, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_accounting_concepts (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL, default_type ENUM('ingreso','egreso') NOT NULL DEFAULT 'egreso', active TINYINT(1) NOT NULL DEFAULT 1, UNIQUE KEY uk_livestock_concepts_name (name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_accounting_entries (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, entry_date DATE NOT NULL, movement_type ENUM('ingreso','egreso') NOT NULL, concept_id INT UNSIGNED NOT NULL, amount_ars DECIMAL(15,2) NOT NULL, usd_rate DECIMAL(15,4) NOT NULL, amount_usd DECIMAL(15,4) NOT NULL, description TEXT NULL, receipt_original_name VARCHAR(255) NULL, receipt_relative_path VARCHAR(500) NULL, receipt_mime_type VARCHAR(100) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_livestock_accounting_concept FOREIGN KEY (concept_id) REFERENCES livestock_accounting_concepts(id), INDEX idx_livestock_accounting_date (entry_date), INDEX idx_livestock_accounting_type (movement_type), INDEX idx_livestock_accounting_concept (concept_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_soil_assessments (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            parcel_id INT UNSIGNED NULL,
            assessment_date DATE NOT NULL,
            title VARCHAR(180) NOT NULL,
            assessment_type ENUM('observacion','prueba_campo','laboratorio') NOT NULL DEFAULT 'observacion',
            sample_code VARCHAR(100) NULL,
            sector VARCHAR(180) NULL,
            depth_cm DECIMAL(8,2) NULL,
            texture ENUM('arenoso','franco_arenoso','franco','franco_arcilloso','arcilloso','limoso','organico','otro') NULL,
            soil_color VARCHAR(100) NULL,
            structure_condition ENUM('suelta','granular','compacta','terronosa','laminar','sin_evaluar') NOT NULL DEFAULT 'sin_evaluar',
            moisture_condition ENUM('seca','adecuada','humeda','saturada','sin_evaluar') NOT NULL DEFAULT 'sin_evaluar',
            drainage_condition ENUM('bueno','lento','encharcado','excesivo','sin_evaluar') NOT NULL DEFAULT 'sin_evaluar',
            compaction_condition ENUM('baja','media','alta','sin_evaluar') NOT NULL DEFAULT 'sin_evaluar',
            infiltration_minutes DECIMAL(10,2) NULL,
            earthworms_count INT UNSIGNED NULL,
            ph_value DECIMAL(5,2) NULL,
            organic_matter_percent DECIMAL(7,3) NULL,
            dry_matter_percent DECIMAL(7,3) NULL,
            electrical_conductivity DECIMAL(10,3) NULL,
            nitrogen_value DECIMAL(12,3) NULL,
            phosphorus_value DECIMAL(12,3) NULL,
            potassium_value DECIMAL(12,3) NULL,
            observed_status ENUM('bien','observar','corregir','laboratorio_pendiente') NOT NULL DEFAULT 'observar',
            recommendations TEXT NULL,
            notes TEXT NULL,
            attachment_original_name VARCHAR(255) NULL,
            attachment_relative_path VARCHAR(500) NULL,
            attachment_mime_type VARCHAR(100) NULL,
            attachment_size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
            created_by_user_id INT UNSIGNED NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_livestock_soil_parcel FOREIGN KEY (parcel_id) REFERENCES livestock_parcels(id) ON DELETE SET NULL,
            CONSTRAINT fk_livestock_soil_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
            INDEX idx_livestock_soil_date (assessment_date),
            INDEX idx_livestock_soil_parcel (parcel_id,assessment_date),
            INDEX idx_livestock_soil_status (observed_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_rainfall (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, rain_date DATE NOT NULL, millimeters DECIMAL(10,2) NOT NULL, notes TEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_livestock_rainfall_date (rain_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_genealogy_records (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cattle_id INT UNSIGNED NOT NULL, recorded_date DATE NOT NULL, sire_cattle_id INT UNSIGNED NULL, dam_cattle_id INT UNSIGNED NULL, sire_reference VARCHAR(180) NULL, dam_reference VARCHAR(180) NULL, breeding_batch VARCHAR(180) NULL, origin VARCHAR(180) NULL, notes TEXT NULL, created_by_user_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_livestock_genealogy_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE, CONSTRAINT fk_livestock_genealogy_sire FOREIGN KEY (sire_cattle_id) REFERENCES livestock_cattle(id) ON DELETE SET NULL, CONSTRAINT fk_livestock_genealogy_dam FOREIGN KEY (dam_cattle_id) REFERENCES livestock_cattle(id) ON DELETE SET NULL, CONSTRAINT fk_livestock_genealogy_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_livestock_genealogy_cattle_date (cattle_id,recorded_date,id), INDEX idx_livestock_genealogy_sire (sire_cattle_id), INDEX idx_livestock_genealogy_dam (dam_cattle_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_herds (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(140) NOT NULL, herd_type ENUM('permanente','temporal') NOT NULL DEFAULT 'temporal', purpose VARCHAR(180) NULL, color VARCHAR(20) NOT NULL DEFAULT '#8a6d4a', parcel_id INT UNSIGNED NULL, status ENUM('activo','cerrado') NOT NULL DEFAULT 'activo', notes TEXT NULL, created_by_user_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_livestock_herds_parcel FOREIGN KEY (parcel_id) REFERENCES livestock_parcels(id) ON DELETE SET NULL, CONSTRAINT fk_livestock_herds_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_livestock_herds_status (status,name), INDEX idx_livestock_herds_parcel (parcel_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_herd_members (herd_id INT UNSIGNED NOT NULL, cattle_id INT UNSIGNED NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1, added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, removed_at DATETIME NULL, notes VARCHAR(255) NULL, PRIMARY KEY (herd_id,cattle_id), CONSTRAINT fk_livestock_herd_members_herd FOREIGN KEY (herd_id) REFERENCES livestock_herds(id) ON DELETE CASCADE, CONSTRAINT fk_livestock_herd_members_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE, INDEX idx_livestock_herd_members_cattle (cattle_id,active)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_reproduction_events (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cattle_id INT UNSIGNED NOT NULL, event_type ENUM('servicio','inseminacion','diagnostico_gestacion','parto','destete','secado','aborto','otro') NOT NULL, event_date DATE NOT NULL, sire_cattle_id INT UNSIGNED NULL, sire_reference VARCHAR(180) NULL, breeding_batch VARCHAR(180) NULL, result VARCHAR(180) NULL, expected_calving_date DATE NULL, calf_cattle_id INT UNSIGNED NULL, health_record_id INT UNSIGNED NULL, notes TEXT NULL, created_by_user_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_livestock_repro_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE, CONSTRAINT fk_livestock_repro_sire FOREIGN KEY (sire_cattle_id) REFERENCES livestock_cattle(id) ON DELETE SET NULL, CONSTRAINT fk_livestock_repro_calf FOREIGN KEY (calf_cattle_id) REFERENCES livestock_cattle(id) ON DELETE SET NULL, CONSTRAINT fk_livestock_repro_health FOREIGN KEY (health_record_id) REFERENCES livestock_health_records(id) ON DELETE SET NULL, CONSTRAINT fk_livestock_repro_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_livestock_repro_cattle_date (cattle_id,event_date,id), INDEX idx_livestock_repro_expected (expected_calving_date), INDEX idx_livestock_repro_calf (calf_cattle_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS livestock_backup_history (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, filename VARCHAR(255) NOT NULL, size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    ];
    foreach ($statements as $sql) {
        db()->exec($sql);
    }

    // Migraciones incrementales de Gestión Ganadera v6.
    $parcelColumns = [
        'pasture_type' => "ALTER TABLE livestock_parcels ADD COLUMN pasture_type VARCHAR(180) NULL AFTER animal_capacity",
        'pasture_variety' => "ALTER TABLE livestock_parcels ADD COLUMN pasture_variety VARCHAR(180) NULL AFTER pasture_type",
        'pasture_stage' => "ALTER TABLE livestock_parcels ADD COLUMN pasture_stage ENUM('sin_pastura','implantacion','crecimiento','vegetativo','floracion','semillado','pastoreo','recuperacion','descanso','degradada') NOT NULL DEFAULT 'sin_pastura' AFTER pasture_variety",
        'pasture_condition' => "ALTER TABLE livestock_parcels ADD COLUMN pasture_condition ENUM('excelente','buena','regular','mala') NULL AFTER pasture_stage",
        'pasture_last_update' => "ALTER TABLE livestock_parcels ADD COLUMN pasture_last_update DATE NULL AFTER pasture_condition",
        'pasture_expected_flowering' => "ALTER TABLE livestock_parcels ADD COLUMN pasture_expected_flowering DATE NULL AFTER pasture_last_update",
        'pasture_grazing_start' => "ALTER TABLE livestock_parcels ADD COLUMN pasture_grazing_start DATE NULL AFTER pasture_expected_flowering",
        'pasture_grazing_end' => "ALTER TABLE livestock_parcels ADD COLUMN pasture_grazing_end DATE NULL AFTER pasture_grazing_start",
        'recommended_rest_days' => "ALTER TABLE livestock_parcels ADD COLUMN recommended_rest_days INT UNSIGNED NULL AFTER pasture_grazing_end",
        'pasture_notes' => "ALTER TABLE livestock_parcels ADD COLUMN pasture_notes TEXT NULL AFTER recommended_rest_days",
    ];
    foreach ($parcelColumns as $column => $sql) {
        if (!column_exists('livestock_parcels', $column)) db()->exec($sql);
    }
    if (!index_exists('livestock_parcels', 'idx_livestock_parcels_pasture_stage')) {
        db()->exec('ALTER TABLE livestock_parcels ADD INDEX idx_livestock_parcels_pasture_stage (pasture_stage)');
    }

    $cattleColumns = [
        'senasa_number' => "ALTER TABLE livestock_cattle ADD COLUMN senasa_number VARCHAR(100) NULL AFTER tag_number",
        'category_id' => "ALTER TABLE livestock_cattle ADD COLUMN category_id INT UNSIGNED NULL AFTER category",
        'body_condition_score' => "ALTER TABLE livestock_cattle ADD COLUMN body_condition_score DECIMAL(3,1) NULL AFTER weight_kg",
        'body_condition_date' => "ALTER TABLE livestock_cattle ADD COLUMN body_condition_date DATE NULL AFTER body_condition_score",
        'market_status' => "ALTER TABLE livestock_cattle ADD COLUMN market_status ENUM('no','observacion','seleccionado','listo') NOT NULL DEFAULT 'no' AFTER body_condition_date",
        'market_date' => "ALTER TABLE livestock_cattle ADD COLUMN market_date DATE NULL AFTER market_status",
        'cover_photo_id' => "ALTER TABLE livestock_cattle ADD COLUMN cover_photo_id INT UNSIGNED NULL AFTER notes",
    ];
    foreach ($cattleColumns as $column => $sql) {
        if (!column_exists('livestock_cattle', $column)) db()->exec($sql);
    }
    foreach ([
        'idx_livestock_cattle_category' => 'category_id',
        'idx_livestock_cattle_market' => 'market_status',
        'idx_livestock_cattle_body_condition' => 'body_condition_score',
        'idx_livestock_cattle_cover_photo' => 'cover_photo_id',
    ] as $index => $column) {
        if (!index_exists('livestock_cattle', $index)) db()->exec("ALTER TABLE livestock_cattle ADD INDEX {$index} ({$column})");
    }
    if (!index_exists('livestock_cattle', 'uk_livestock_cattle_senasa')) {
        db()->exec('ALTER TABLE livestock_cattle ADD UNIQUE INDEX uk_livestock_cattle_senasa (senasa_number)');
    }

    if (!column_exists('livestock_health_records', 'batch_id')) {
        db()->exec('ALTER TABLE livestock_health_records ADD COLUMN batch_id INT UNSIGNED NULL AFTER cattle_id');
    }
    // Amplía tipos sanitarios una sola vez, conservando todos los datos existentes.
    $healthTypeColumn = query_one("SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='livestock_health_records' AND COLUMN_NAME='record_type'");
    if ($healthTypeColumn && !str_contains((string)$healthTypeColumn['COLUMN_TYPE'], 'vaca_prenada')) {
        db()->exec("ALTER TABLE livestock_health_records MODIFY record_type ENUM('vacunacion','tratamiento','control','enfermedad','servicio','parto','desparasitacion','revision_reproductiva','vaca_prenada','inseminacion','otro') NOT NULL DEFAULT 'control'");
    }
    $healthBatchTypeColumn = query_one("SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='livestock_health_batches' AND COLUMN_NAME='record_type'");
    if ($healthBatchTypeColumn && !str_contains((string)$healthBatchTypeColumn['COLUMN_TYPE'], 'vaca_prenada')) {
        db()->exec("ALTER TABLE livestock_health_batches MODIFY record_type ENUM('vacunacion','tratamiento','control','enfermedad','servicio','parto','desparasitacion','revision_reproductiva','vaca_prenada','inseminacion','otro') NOT NULL DEFAULT 'control'");
    }
    if (!index_exists('livestock_health_records', 'idx_livestock_health_batch')) {
        db()->exec('ALTER TABLE livestock_health_records ADD INDEX idx_livestock_health_batch (batch_id)');
    }

    if (!column_exists('livestock_cattle', 'pregnancy_date')) db()->exec('ALTER TABLE livestock_cattle ADD COLUMN pregnancy_date DATE NULL AFTER market_date');
    if (!column_exists('livestock_cattle', 'expected_calving_date')) db()->exec('ALTER TABLE livestock_cattle ADD COLUMN expected_calving_date DATE NULL AFTER pregnancy_date');
    if (!column_exists('livestock_cattle', 'animal_class')) db()->exec("ALTER TABLE livestock_cattle ADD COLUMN animal_class ENUM('vaca','vaquillona','ternera','ternero','toro','novillo','otro') NOT NULL DEFAULT 'vaca' AFTER sex");
    if (!column_exists('livestock_cattle', 'reproductive_status')) db()->exec("ALTER TABLE livestock_cattle ADD COLUMN reproductive_status ENUM('sin_definir','vacia','servida','inseminada','gestante','en_paricion','ternero_al_pie','seca','no_aplica') NOT NULL DEFAULT 'sin_definir' AFTER animal_class");
    if (!column_exists('livestock_cattle', 'commercial_destination')) db()->exec("ALTER TABLE livestock_cattle ADD COLUMN commercial_destination ENUM('sin_definir','reposicion','cut','venta','vendida') NOT NULL DEFAULT 'sin_definir' AFTER reproductive_status");
    foreach (['idx_livestock_cattle_class'=>'animal_class','idx_livestock_cattle_reproductive'=>'reproductive_status','idx_livestock_cattle_destination'=>'commercial_destination'] as $idx=>$col) {
        if (!index_exists('livestock_cattle', $idx)) db()->exec("ALTER TABLE livestock_cattle ADD INDEX {$idx} ({$col})");
    }
    if (!column_exists('livestock_activities', 'herd_id')) {
        db()->exec('ALTER TABLE livestock_activities ADD COLUMN herd_id INT UNSIGNED NULL AFTER parcel_id');
        db()->exec('ALTER TABLE livestock_activities ADD INDEX idx_livestock_activities_herd (herd_id)');
    }
    foreach ([
        'ground_cover_percent'=>"ALTER TABLE livestock_soil_assessments ADD COLUMN ground_cover_percent DECIMAL(5,2) NULL AFTER earthworms_count",
        'root_depth_cm'=>"ALTER TABLE livestock_soil_assessments ADD COLUMN root_depth_cm DECIMAL(8,2) NULL AFTER ground_cover_percent",
        'erosion_condition'=>"ALTER TABLE livestock_soil_assessments ADD COLUMN erosion_condition ENUM('sin_evaluar','sin_erosion','leve','moderada','severa') NOT NULL DEFAULT 'sin_evaluar' AFTER compaction_condition",
        'biological_activity'=>"ALTER TABLE livestock_soil_assessments ADD COLUMN biological_activity ENUM('sin_evaluar','baja','media','alta') NOT NULL DEFAULT 'sin_evaluar' AFTER erosion_condition",
        'management_action'=>"ALTER TABLE livestock_soil_assessments ADD COLUMN management_action VARCHAR(255) NULL AFTER recommendations",
        'next_review_date'=>"ALTER TABLE livestock_soil_assessments ADD COLUMN next_review_date DATE NULL AFTER management_action",
    ] as $column=>$sql) { if (!column_exists('livestock_soil_assessments',$column)) db()->exec($sql); }
    db()->exec("CREATE TABLE IF NOT EXISTS livestock_parcel_events (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        parcel_id INT UNSIGNED NOT NULL,
        pasture_id INT UNSIGNED NULL,
        event_type ENUM('inicio_pastoreo','fin_pastoreo','inicio_descanso','fin_descanso') NOT NULL,
        event_date DATE NOT NULL,
        notes TEXT NULL,
        photo_original_name VARCHAR(255) NULL,
        photo_relative_path VARCHAR(500) NULL,
        photo_mime_type VARCHAR(100) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_livestock_parcel_event_parcel FOREIGN KEY (parcel_id) REFERENCES livestock_parcels(id) ON DELETE CASCADE,
        CONSTRAINT fk_livestock_parcel_event_pasture FOREIGN KEY (pasture_id) REFERENCES livestock_pastures(id) ON DELETE SET NULL,
        INDEX idx_livestock_parcel_event_date (parcel_id,event_date,id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    execute_sql("INSERT IGNORE INTO livestock_field_banner (id, caption) VALUES (1, 'Vista general del campo')");
    execute_sql("INSERT IGNORE INTO livestock_activity_statuses (id,name,slug,sort_order,color,is_closed) VALUES (1,'Pendientes','pendientes',10,'#f59e0b',0),(2,'Haciéndose','haciendose',20,'#3b82f6',0),(3,'Terminadas','terminadas',30,'#10b981',1)");
    // Categorías fijas de Gestión Ganadera v7. No se agregan categorías fuera de esta lista.
    // Conserva los IDs de categorías anteriores cuando existe una equivalencia clara.
    execute_sql("UPDATE livestock_categories SET name='Ternero', slug='ternero', description='Ternero macho.', market_group=0, active=1, sort_order=60 WHERE slug='ternero'");
    execute_sql("UPDATE livestock_categories SET name='Reposición', slug='reposicion', description='Animales reservados para reposición del rodeo.', market_group=0, active=1, sort_order=80 WHERE slug='recria'");
    execute_sql("UPDATE livestock_categories SET name='Vendida', slug='vendida', description='Animales vendidos o dados de salida.', market_group=1, active=1, sort_order=90 WHERE slug='salida-mercado'");
    $categories = [
        ['Vaca vacía','vaca-vacia','#9b6b43','Vacas sin preñez confirmada.',0,10],
        ['En parición','en-paricion','#d97706','Animales próximos al parto o en período de parición.',0,20],
        ['Seca','seca','#64748b','Vacas en período seco.',0,30],
        ['CUT','cut','#7c3aed','Categoría CUT según criterio del establecimiento.',0,40],
        ['Vaquillona','vaquillona','#db2777','Hembras jóvenes antes del primer parto.',0,50],
        ['Ternero','ternero','#0ea5e9','Ternero macho.',0,60],
        ['Ternera','ternera','#38bdf8','Ternera hembra.',0,70],
        ['Reposición','reposicion','#059669','Animales reservados para reposición del rodeo.',0,80],
        ['Vendida','vendida','#dc2626','Animales vendidos o dados de salida.',1,90],
        ['Vaca gestante','vaca-gestante','#c026d3','Vaca con gestación confirmada.',0,100],
        ['Vaca ternero al pie','vaca-ternero-al-pie','#16a34a','Vaca con ternero al pie.',0,110],
        ['Ternero Guacho','ternero-guacho','#2563eb','Ternero criado sin su madre.',0,120],
    ];
    foreach ($categories as [$name,$slug,$color,$description,$market,$sort]) {
        execute_sql('INSERT IGNORE INTO livestock_categories (name,slug,color,description,market_group,active,sort_order) VALUES (?,?,?,?,?,1,?)', [$name,$slug,$color,$description,$market,$sort]);
        execute_sql('UPDATE livestock_categories SET name=?,color=?,description=?,market_group=?,active=1,sort_order=? WHERE slug=?', [$name,$color,$description,$market,$sort,$slug]);
    }
    execute_sql("UPDATE livestock_categories SET active=0 WHERE slug NOT IN ('vaca-vacia','en-paricion','seca','cut','vaquillona','ternero','ternera','reposicion','vendida','vaca-gestante','vaca-ternero-al-pie','ternero-guacho')");
    execute_sql("UPDATE livestock_cattle c JOIN livestock_categories cat ON cat.id=c.category_id SET c.category=cat.name");
    $classificationMigration = query_one("SELECT setting_value FROM app_settings WHERE setting_key='livestock_v20_classification_migrated'");
    if (!$classificationMigration) {
        execute_sql("UPDATE livestock_cattle c LEFT JOIN livestock_categories cat ON cat.id=c.category_id SET
            c.animal_class=CASE
                WHEN c.sex='macho' AND COALESCE(cat.slug,'') IN ('ternero','ternero-guacho') THEN 'ternero'
                WHEN c.sex='macho' AND COALESCE(cat.slug,'')='toro' THEN 'toro'
                WHEN c.sex='macho' THEN 'novillo'
                WHEN COALESCE(cat.slug,'')='vaquillona' THEN 'vaquillona'
                WHEN COALESCE(cat.slug,'')='ternera' THEN 'ternera'
                ELSE 'vaca' END,
            c.reproductive_status=CASE COALESCE(cat.slug,'')
                WHEN 'vaca-vacia' THEN 'vacia' WHEN 'vaca-gestante' THEN 'gestante' WHEN 'en-paricion' THEN 'en_paricion'
                WHEN 'vaca-ternero-al-pie' THEN 'ternero_al_pie' WHEN 'seca' THEN 'seca'
                ELSE CASE WHEN c.sex='macho' THEN 'no_aplica' ELSE 'sin_definir' END END,
            c.commercial_destination=CASE COALESCE(cat.slug,'')
                WHEN 'cut' THEN 'cut' WHEN 'reposicion' THEN 'reposicion' WHEN 'vendida' THEN 'vendida' ELSE 'sin_definir' END");
        execute_sql("INSERT INTO app_settings (setting_key,setting_value) VALUES ('livestock_v20_classification_migrated','1') ON DUPLICATE KEY UPDATE setting_value='1'");
    }

    // Migra el histórico corporal anterior al nuevo historial unificado de características.
    execute_sql("INSERT IGNORE INTO livestock_cattle_characteristics (cattle_id,record_date,body_condition_score,notes,source_body_condition_id)
                 SELECT cattle_id,assessment_date,score,notes,id FROM livestock_body_condition_records");

    // Convierte la pastura única de versiones anteriores en una tarjeta, una sola vez por parcela.
    execute_sql("INSERT INTO livestock_pastures (parcel_id,name,variety,stage,pasture_condition,last_update,expected_flowering,grazing_start,grazing_end,recommended_rest_days,notes,legacy_import)
                 SELECT p.id,COALESCE(NULLIF(p.pasture_type,''),'Pastura registrada'),p.pasture_variety,
                        CASE WHEN p.pasture_stage='sin_pastura' THEN 'crecimiento' ELSE p.pasture_stage END,
                        p.pasture_condition,p.pasture_last_update,p.pasture_expected_flowering,p.pasture_grazing_start,p.pasture_grazing_end,p.recommended_rest_days,p.pasture_notes,1
                 FROM livestock_parcels p
                 WHERE (NULLIF(p.pasture_type,'') IS NOT NULL OR NULLIF(p.pasture_variety,'') IS NOT NULL OR NULLIF(p.pasture_notes,'') IS NOT NULL)
                   AND NOT EXISTS (SELECT 1 FROM livestock_pastures lp WHERE lp.parcel_id=p.id AND lp.legacy_import=1)");

    $labels = [
        ['Sanidad','#dc2626'],['Vacunación','#ec4899'],['Alimentación','#f59e0b'],['Movimiento','#6366f1'],
        ['Alambrado','#7856ad'],['Agua','#0ea5e9'],['Pastura','#16a34a'],['Pesaje','#64748b'],
        ['Revisión','#3976bd'],['Compra','#b97511'],
    ];
    foreach ($labels as [$name,$color]) {
        execute_sql('INSERT IGNORE INTO livestock_activity_labels (name,color) VALUES (?,?)', [$name,$color]);
    }
    $concepts = [
        ['Alimento','egreso'],['Sanidad y medicamentos','egreso'],['Alambrados e infraestructura','egreso'],
        ['Compra de animales','egreso'],['Venta de animales','ingreso'],['Servicios','egreso'],
        ['Otros ingresos','ingreso'],['Otros egresos','egreso'],
    ];
    foreach ($concepts as [$name,$type]) {
        execute_sql('INSERT IGNORE INTO livestock_accounting_concepts (name,default_type) VALUES (?,?)', [$name,$type]);
    }

    $existing = query_one('SELECT id FROM users WHERE LOWER(username)=? LIMIT 1', ['ganaderia']);
    if (!$existing) {
        execute_sql(
            "INSERT INTO users (username, display_name, app_code, role, password_hash, active) VALUES ('Ganaderia','Ganadería','ganaderia','administrador',?,1)",
            [password_hash('Ganaderia123#', PASSWORD_DEFAULT)]
        );
    } else {
        execute_sql("UPDATE users SET display_name='Ganadería', app_code='ganaderia', role='administrador', active=1 WHERE id=?", [(int)$existing['id']]);
    }
    $ganaderiaUser = query_one('SELECT id FROM users WHERE LOWER(username)=? LIMIT 1', ['ganaderia']);
    if ($ganaderiaUser && table_exists('user_app_access')) {
        execute_sql("INSERT IGNORE INTO user_app_access (user_id, app_code) VALUES (?, 'ganaderia')", [(int)$ganaderiaUser['id']]);
    }
}


function ensure_management_calendar_schema(): void
{
    if (!table_exists('users')) return;
    db()->exec("CREATE TABLE IF NOT EXISTS management_calendar_events (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        app_code VARCHAR(40) NOT NULL,
        title VARCHAR(180) NOT NULL,
        event_type VARCHAR(80) NOT NULL DEFAULT 'general',
        start_date DATE NOT NULL,
        end_date DATE NULL,
        notes TEXT NULL,
        color VARCHAR(20) NOT NULL DEFAULT '#3976bd',
        created_by_user_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_management_calendar_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_management_calendar_app_date (app_code,start_date),
        INDEX idx_management_calendar_type (app_code,event_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}


function ensure_google_calendar_schema(): void
{
    if (!table_exists('users')) return;
    db()->exec("CREATE TABLE IF NOT EXISTS user_google_calendar_connections (
        user_id INT UNSIGNED NOT NULL,
        app_code VARCHAR(40) NOT NULL,
        google_email VARCHAR(190) NULL,
        calendar_id VARCHAR(255) NOT NULL DEFAULT 'primary',
        access_token TEXT NULL,
        refresh_token TEXT NULL,
        token_expires_at DATETIME NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        email_reminder_minutes INT UNSIGNED NOT NULL DEFAULT 1440,
        popup_reminder_minutes INT UNSIGNED NOT NULL DEFAULT 120,
        last_sync_at DATETIME NULL,
        last_sync_error TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, app_code),
        CONSTRAINT fk_google_calendar_connection_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_google_calendar_connection_app (app_code, enabled)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    db()->exec("CREATE TABLE IF NOT EXISTS google_calendar_oauth_states (
        state_token CHAR(48) PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        app_code VARCHAR(40) NOT NULL,
        notification_email VARCHAR(190) NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_google_calendar_state_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_google_calendar_state_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    db()->exec("CREATE TABLE IF NOT EXISTS google_calendar_event_links (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        app_code VARCHAR(40) NOT NULL,
        source_type ENUM('event','activity') NOT NULL,
        source_id INT UNSIGNED NOT NULL,
        google_event_id VARCHAR(255) NULL,
        source_updated_at DATETIME NULL,
        last_synced_at DATETIME NULL,
        sync_error TEXT NULL,
        CONSTRAINT fk_google_calendar_link_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY uk_google_calendar_link_source (user_id,app_code,source_type,source_id),
        INDEX idx_google_calendar_link_event (google_event_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    execute_sql('DELETE FROM google_calendar_oauth_states WHERE expires_at<NOW()');
}

function ensure_community_schema(): void
{
    if (!table_exists('users')) return;
    $statements = [
        "CREATE TABLE IF NOT EXISTS community_hives (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL, status ENUM('activa','inactiva','observacion','baja') NOT NULL DEFAULT 'activa', creation_date DATE NOT NULL, queen_year SMALLINT UNSIGNED NULL, cover_photo_id INT UNSIGNED NULL, created_by_user_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uk_community_hives_name (name), CONSTRAINT fk_community_hives_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_community_hives_status (status)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_hive_notes (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, hive_id INT UNSIGNED NOT NULL, note TEXT NOT NULL, note_date DATE NOT NULL, created_by_user_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_community_notes_hive FOREIGN KEY (hive_id) REFERENCES community_hives(id) ON DELETE CASCADE, CONSTRAINT fk_community_notes_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_community_notes_hive_date (hive_id,note_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_hive_photos (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, hive_id INT UNSIGNED NOT NULL, original_name VARCHAR(255) NOT NULL, relative_path VARCHAR(500) NOT NULL, mime_type VARCHAR(100) NOT NULL, size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0, caption VARCHAR(255) NULL, uploaded_by_user_id INT UNSIGNED NULL, uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_community_photos_hive FOREIGN KEY (hive_id) REFERENCES community_hives(id) ON DELETE CASCADE, CONSTRAINT fk_community_photos_user FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_community_photos_hive (hive_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_hive_queen_history (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, hive_id INT UNSIGNED NOT NULL, queen_year SMALLINT UNSIGNED NOT NULL, change_date DATE NOT NULL, notes TEXT NULL, created_by_user_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_community_queen_hive FOREIGN KEY (hive_id) REFERENCES community_hives(id) ON DELETE CASCADE, CONSTRAINT fk_community_queen_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_community_queen_date (hive_id,change_date,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_health_records (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, record_date DATE NOT NULL, treatment_type VARCHAR(60) NOT NULL, condition_name VARCHAR(180) NULL, product VARCHAR(180) NULL, dose VARCHAR(120) NULL, end_date DATE NULL, result VARCHAR(255) NULL, notes TEXT NULL, created_by_user_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_community_health_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_community_health_date (record_date), INDEX idx_community_health_type (treatment_type)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_health_hives (health_record_id INT UNSIGNED NOT NULL, hive_id INT UNSIGNED NOT NULL, PRIMARY KEY (health_record_id,hive_id), CONSTRAINT fk_community_health_rel_record FOREIGN KEY (health_record_id) REFERENCES community_health_records(id) ON DELETE CASCADE, CONSTRAINT fk_community_health_rel_hive FOREIGN KEY (hive_id) REFERENCES community_hives(id) ON DELETE CASCADE, INDEX idx_community_health_rel_hive (hive_id,health_record_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_activity_statuses (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL, slug VARCHAR(50) NOT NULL, sort_order INT NOT NULL DEFAULT 0, color VARCHAR(20) NOT NULL DEFAULT '#64748b', is_closed TINYINT(1) NOT NULL DEFAULT 0, UNIQUE KEY uk_community_status_slug (slug)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_activity_labels (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL, color VARCHAR(20) NOT NULL DEFAULT '#f4b942', UNIQUE KEY uk_community_label_name (name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_activities (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, title VARCHAR(180) NOT NULL, description TEXT NULL, hive_id INT UNSIGNED NULL, responsible_user_id INT UNSIGNED NULL, created_by_user_id INT UNSIGNED NULL, completed_by_user_id INT UNSIGNED NULL, status_id INT UNSIGNED NOT NULL, label_id INT UNSIGNED NULL, priority ENUM('baja','normal','alta','urgente') NOT NULL DEFAULT 'normal', due_date DATE NULL, position INT NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, completed_at DATETIME NULL, CONSTRAINT fk_community_activity_hive FOREIGN KEY (hive_id) REFERENCES community_hives(id) ON DELETE SET NULL, CONSTRAINT fk_community_activity_responsible FOREIGN KEY (responsible_user_id) REFERENCES users(id) ON DELETE SET NULL, CONSTRAINT fk_community_activity_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, CONSTRAINT fk_community_activity_completed FOREIGN KEY (completed_by_user_id) REFERENCES users(id) ON DELETE SET NULL, CONSTRAINT fk_community_activity_status FOREIGN KEY (status_id) REFERENCES community_activity_statuses(id), CONSTRAINT fk_community_activity_label FOREIGN KEY (label_id) REFERENCES community_activity_labels(id) ON DELETE SET NULL, INDEX idx_community_activity_status (status_id,position), INDEX idx_community_activity_person (responsible_user_id,due_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_activity_attachments (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, activity_id INT UNSIGNED NOT NULL, original_name VARCHAR(255) NOT NULL, relative_path VARCHAR(500) NOT NULL, mime_type VARCHAR(100) NOT NULL, size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0, uploaded_by_user_id INT UNSIGNED NULL, uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_community_attach_activity FOREIGN KEY (activity_id) REFERENCES community_activities(id) ON DELETE CASCADE, CONSTRAINT fk_community_attach_user FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_community_attach_activity (activity_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_activity_logs (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, activity_id INT UNSIGNED NOT NULL, user_id INT UNSIGNED NULL, action VARCHAR(120) NOT NULL, details TEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_community_log_activity FOREIGN KEY (activity_id) REFERENCES community_activities(id) ON DELETE CASCADE, CONSTRAINT fk_community_log_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_community_log_date (activity_id,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_materials (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(160) NOT NULL, category VARCHAR(100) NOT NULL DEFAULT 'Otros materiales', photo_original_name VARCHAR(255) NULL, photo_relative_path VARCHAR(500) NULL, photo_mime_type VARCHAR(100) NULL, owner_user_id INT UNSIGNED NULL, holder_user_id INT UNSIGNED NULL, status ENUM('disponible','en_uso','reparacion') NOT NULL DEFAULT 'disponible', hive_id INT UNSIGNED NULL, notes TEXT NULL, source_purchase_plan_id INT UNSIGNED NULL, source_purchase_item_id INT UNSIGNED NULL, created_by_user_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_community_material_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL, CONSTRAINT fk_community_material_holder FOREIGN KEY (holder_user_id) REFERENCES users(id) ON DELETE SET NULL, CONSTRAINT fk_community_material_hive FOREIGN KEY (hive_id) REFERENCES community_hives(id) ON DELETE SET NULL, CONSTRAINT fk_community_material_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_community_material_status (status), INDEX idx_community_material_category (category), INDEX idx_community_material_owner (owner_user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_purchase_plans (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, title VARCHAR(180) NOT NULL, plan_month DATE NOT NULL, notes TEXT NULL, status ENUM('pendiente','realizada') NOT NULL DEFAULT 'pendiente', proposed_by_user_id INT UNSIGNED NULL, completed_by_user_id INT UNSIGNED NULL, paid_by_user_id INT UNSIGNED NULL, expense_scope ENUM('comunitario','personal') NOT NULL DEFAULT 'comunitario', completed_at DATETIME NULL, materials_generated_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_community_plan_proposer FOREIGN KEY (proposed_by_user_id) REFERENCES users(id) ON DELETE SET NULL, CONSTRAINT fk_community_plan_completer FOREIGN KEY (completed_by_user_id) REFERENCES users(id) ON DELETE SET NULL, CONSTRAINT fk_community_plan_payer FOREIGN KEY (paid_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_community_plan_month (plan_month), INDEX idx_community_plan_status (status)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_purchase_items (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, plan_id INT UNSIGNED NOT NULL, item_name VARCHAR(180) NOT NULL, quantity DECIMAL(12,3) NOT NULL DEFAULT 1, unit_price DECIMAL(15,2) NOT NULL DEFAULT 0, purchase_place VARCHAR(180) NULL, is_purchased TINYINT(1) NOT NULL DEFAULT 0, notes TEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_community_item_plan FOREIGN KEY (plan_id) REFERENCES community_purchase_plans(id) ON DELETE CASCADE, INDEX idx_community_item_plan (plan_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_accounting_concepts (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL, default_type ENUM('ingreso','egreso') NOT NULL DEFAULT 'egreso', active TINYINT(1) NOT NULL DEFAULT 1, UNIQUE KEY uk_community_concept_name (name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_accounting_entries (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, entry_date DATE NOT NULL, person_user_id INT UNSIGNED NULL, movement_type ENUM('ingreso','egreso') NOT NULL, concept_id INT UNSIGNED NOT NULL, amount_ars DECIMAL(15,2) NOT NULL, usd_rate DECIMAL(15,4) NOT NULL, amount_usd DECIMAL(15,4) NOT NULL, description TEXT NULL, receipt_original_name VARCHAR(255) NULL, receipt_relative_path VARCHAR(500) NULL, receipt_mime_type VARCHAR(100) NULL, created_by_user_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_community_account_person FOREIGN KEY (person_user_id) REFERENCES users(id) ON DELETE SET NULL, CONSTRAINT fk_community_account_concept FOREIGN KEY (concept_id) REFERENCES community_accounting_concepts(id), CONSTRAINT fk_community_account_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_community_account_date (entry_date), INDEX idx_community_account_person (person_user_id), INDEX idx_community_account_type (movement_type)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS community_backup_history (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, filename VARCHAR(255) NOT NULL, size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    ];
    foreach ($statements as $sql) db()->exec($sql);

    // Manejo de colmenas de Comunidad Apícola. Se mantiene separado de Gestión Apícola.
    db()->exec("CREATE TABLE IF NOT EXISTS community_apiary_seasons (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 0, notes TEXT NULL, created_by_user_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_community_apiary_season_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE KEY uk_community_apiary_season_name (name), INDEX idx_community_apiary_season_dates (start_date,end_date), INDEX idx_community_apiary_season_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    if (!(int)(query_one('SELECT COUNT(*) total FROM community_apiary_seasons')['total'] ?? 0)) {
        $cy=(int)date('Y'); $cm=(int)date('n'); $csy=$cm>=7?$cy:$cy-1; $cey=$csy+1;
        execute_sql('INSERT INTO community_apiary_seasons (name,start_date,end_date,is_active,notes) VALUES (?,?,?,?,?)',[sprintf('%d/%02d',$csy,$cey%100),sprintf('%04d-07-01',$csy),sprintf('%04d-06-30',$cey),1,'Temporada creada automáticamente para el manejo de la Comunidad Apícola.']);
    }
    db()->exec("CREATE TABLE IF NOT EXISTS community_hive_inspections (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, hive_id INT UNSIGNED NOT NULL, season_id INT UNSIGNED NULL, inspection_date DATE NOT NULL,
        queen_seen TINYINT(1) NOT NULL DEFAULT 0, laying_status VARCHAR(40) NOT NULL DEFAULT 'sin_evaluar', frames_bees SMALLINT UNSIGNED NULL,
        honey_reserve_status VARCHAR(30) NULL, pollen_reserve_status VARCHAR(30) NULL, queen_cells SMALLINT UNSIGNED NULL, temperament VARCHAR(40) NULL,
        swarm_signs TINYINT(1) NOT NULL DEFAULT 0, notes TEXT NULL, created_by_user_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_community_inspection_hive FOREIGN KEY (hive_id) REFERENCES community_hives(id) ON DELETE CASCADE,
        CONSTRAINT fk_community_inspection_season FOREIGN KEY (season_id) REFERENCES community_apiary_seasons(id) ON DELETE SET NULL,
        CONSTRAINT fk_community_inspection_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_community_inspection_hive_date (hive_id,inspection_date), INDEX idx_community_inspection_season_date (season_id,inspection_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    db()->exec("CREATE TABLE IF NOT EXISTS community_hive_inspection_files (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, inspection_id INT UNSIGNED NOT NULL, original_name VARCHAR(255) NOT NULL, relative_path VARCHAR(500) NOT NULL,
        mime_type VARCHAR(100) NOT NULL, size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0, uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_community_inspection_file FOREIGN KEY (inspection_id) REFERENCES community_hive_inspections(id) ON DELETE CASCADE,
        INDEX idx_community_inspection_file_parent (inspection_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    db()->exec("CREATE TABLE IF NOT EXISTS community_apiary_harvests (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, season_id INT UNSIGNED NULL, harvest_date DATE NOT NULL, batch_code VARCHAR(120) NULL, honey_type VARCHAR(160) NULL,
        total_kg DECIMAL(12,3) NOT NULL DEFAULT 0, moisture_pct DECIMAL(6,2) NULL, containers VARCHAR(255) NULL, notes TEXT NULL, created_by_user_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_community_harvest_season FOREIGN KEY (season_id) REFERENCES community_apiary_seasons(id) ON DELETE SET NULL,
        CONSTRAINT fk_community_harvest_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_community_harvest_date (harvest_date), INDEX idx_community_harvest_season (season_id,harvest_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    db()->exec("CREATE TABLE IF NOT EXISTS community_apiary_harvest_hives (
        harvest_id INT UNSIGNED NOT NULL, hive_id INT UNSIGNED NOT NULL, attributed_kg DECIMAL(12,3) NOT NULL DEFAULT 0,
        PRIMARY KEY (harvest_id,hive_id), CONSTRAINT fk_community_harvest_rel_parent FOREIGN KEY (harvest_id) REFERENCES community_apiary_harvests(id) ON DELETE CASCADE,
        CONSTRAINT fk_community_harvest_rel_hive FOREIGN KEY (hive_id) REFERENCES community_hives(id) ON DELETE CASCADE, INDEX idx_community_harvest_rel_hive (hive_id,harvest_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    if (table_exists('community_health_records') && !column_exists('community_health_records','season_id')) {
        db()->exec('ALTER TABLE community_health_records ADD COLUMN season_id INT UNSIGNED NULL AFTER id');
        db()->exec('ALTER TABLE community_health_records ADD INDEX idx_community_health_season (season_id,record_date)');
    }
    if (table_exists('community_health_records') && column_exists('community_health_records','season_id')) {
        $communityActiveSeason=(int)(query_one("SELECT id FROM community_apiary_seasons WHERE is_active=1 ORDER BY start_date DESC,id DESC LIMIT 1")['id'] ?? 0);
        if ($communityActiveSeason) execute_sql('UPDATE community_health_records SET season_id=? WHERE season_id IS NULL',[$communityActiveSeason]);
    }
    db()->exec("CREATE TABLE IF NOT EXISTS community_apiary_feedings (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, season_id INT UNSIGNED NULL, feeding_date DATE NOT NULL, feed_type VARCHAR(120) NOT NULL,
        quantity_per_hive DECIMAL(12,3) NOT NULL DEFAULT 0, unit VARCHAR(30) NOT NULL DEFAULT 'kg', reason VARCHAR(255) NULL, notes TEXT NULL, created_by_user_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_community_feeding_season FOREIGN KEY (season_id) REFERENCES community_apiary_seasons(id) ON DELETE SET NULL,
        CONSTRAINT fk_community_feeding_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_community_feeding_date (feeding_date), INDEX idx_community_feeding_season (season_id,feeding_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    db()->exec("CREATE TABLE IF NOT EXISTS community_apiary_feeding_hives (
        feeding_id INT UNSIGNED NOT NULL, hive_id INT UNSIGNED NOT NULL, PRIMARY KEY (feeding_id,hive_id),
        CONSTRAINT fk_community_feeding_rel_parent FOREIGN KEY (feeding_id) REFERENCES community_apiary_feedings(id) ON DELETE CASCADE,
        CONSTRAINT fk_community_feeding_rel_hive FOREIGN KEY (hive_id) REFERENCES community_hives(id) ON DELETE CASCADE, INDEX idx_community_feeding_rel_hive (hive_id,feeding_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $communityIndexes = [
        ['community_activities','idx_community_activity_due','due_date'],
        ['community_activities','idx_community_activity_hive','hive_id'],
        ['community_hive_photos','idx_community_photos_uploaded','uploaded_at'],
        ['community_hive_notes','idx_community_notes_date','note_date'],
    ];
    foreach ($communityIndexes as [$table,$index,$column]) {
        if (table_exists($table) && !index_exists($table,$index)) db()->exec("ALTER TABLE `{$table}` ADD INDEX `{$index}` (`{$column}`)");
    }
    if (table_exists('community_materials') && !column_exists('community_materials','category')) db()->exec("ALTER TABLE community_materials ADD COLUMN category VARCHAR(100) NOT NULL DEFAULT 'Otros materiales' AFTER name");
    if (table_exists('community_materials') && !column_exists('community_materials','photo_original_name')) db()->exec('ALTER TABLE community_materials ADD COLUMN photo_original_name VARCHAR(255) NULL AFTER category');
    if (table_exists('community_materials') && !column_exists('community_materials','photo_relative_path')) db()->exec('ALTER TABLE community_materials ADD COLUMN photo_relative_path VARCHAR(500) NULL AFTER photo_original_name');
    if (table_exists('community_materials') && !column_exists('community_materials','photo_mime_type')) db()->exec('ALTER TABLE community_materials ADD COLUMN photo_mime_type VARCHAR(100) NULL AFTER photo_relative_path');
    if (table_exists('community_materials') && !index_exists('community_materials','idx_community_material_category')) db()->exec('ALTER TABLE community_materials ADD INDEX idx_community_material_category (category)');
    db()->exec("CREATE TABLE IF NOT EXISTS community_material_categories (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,name VARCHAR(100) NOT NULL,sort_order INT NOT NULL DEFAULT 100,created_by_user_id INT UNSIGNED NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY uk_community_material_categories_name (name),INDEX idx_community_material_categories_order (sort_order,name),CONSTRAINT fk_community_material_category_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    execute_sql("INSERT IGNORE INTO community_material_categories (name) VALUES ('Otros materiales')");
    if (table_exists('community_materials')) execute_sql("INSERT IGNORE INTO community_material_categories (name) SELECT DISTINCT category FROM community_materials WHERE category IS NOT NULL AND TRIM(category)<>''");
    execute_sql("INSERT IGNORE INTO community_activity_statuses (id,name,slug,sort_order,color,is_closed) VALUES (1,'Pendientes','pendientes',10,'#f59e0b',0),(2,'Haciéndose','haciendose',20,'#3b82f6',0),(3,'Terminadas','terminadas',30,'#10b981',1)");
    $labels=[['Alimento','#f59e0b'],['Fusión','#8b5cf6'],['Cambio de reina','#ec4899'],['Falta de cría','#ef4444'],['Agregar alza','#0ea5e9'],['Sacar alza','#14b8a6'],['Celda real','#d946ef'],['Caída','#dc2626'],['Movimiento','#6366f1'],['Materiales','#64748b'],['Extracción','#16a34a'],['Control sanitario','#4f8b62']];
    foreach($labels as [$name,$color]) execute_sql('INSERT IGNORE INTO community_activity_labels (name,color) VALUES (?,?)',[$name,$color]);
    $oldCommunity=query_one("SELECT id FROM community_activity_labels WHERE LOWER(name)='comunidad' LIMIT 1");
    $healthLabel=query_one("SELECT id FROM community_activity_labels WHERE LOWER(name)='control sanitario' LIMIT 1");
    if($oldCommunity&&$healthLabel&&((int)$oldCommunity['id']!==(int)$healthLabel['id'])){execute_sql('UPDATE community_activities SET label_id=? WHERE label_id=?',[(int)$healthLabel['id'],(int)$oldCommunity['id']]);execute_sql('DELETE FROM community_activity_labels WHERE id=?',[(int)$oldCommunity['id']]);}
    $concepts=[['Insumos','egreso'],['Medicamentos','egreso'],['Venta','ingreso'],['Materiales','egreso'],['Aporte comunitario','ingreso'],['Gasto comunitario','egreso']];
    foreach($concepts as [$name,$type]) execute_sql('INSERT IGNORE INTO community_accounting_concepts (name,default_type) VALUES (?,?)',[$name,$type]);

    $communityUsers=[['Nanay','Nanay'],['Martin','Martín'],['Sergio','Sergio']];
    foreach($communityUsers as [$username,$display]){
        $existing=query_one('SELECT id FROM users WHERE LOWER(username)=LOWER(?) LIMIT 1',[$username]);
        $alreadyHadCommunity=false;
        if($existing){
            $alreadyHadCommunity=(bool)query_one("SELECT user_id FROM user_app_access WHERE user_id=? AND app_code='comunidad' LIMIT 1",[(int)$existing['id']]);
        }
        if(!$existing){
            execute_sql("INSERT INTO users (username,display_name,app_code,role,password_hash,active) VALUES (?,?,'comunidad','usuario',?,1)",[$username,$display,password_hash('Apicultura123#',PASSWORD_DEFAULT)]);
            $userId=(int)db()->lastInsertId();
        }else{
            $userId=(int)$existing['id'];
            execute_sql("UPDATE users SET display_name=?,active=1 WHERE id=?",[$display,$userId]);
            if(!$alreadyHadCommunity){
                execute_sql('UPDATE users SET password_hash=? WHERE id=?',[password_hash('Apicultura123#',PASSWORD_DEFAULT),$userId]);
            }
        }
        execute_sql("INSERT IGNORE INTO user_app_access (user_id,app_code) VALUES (?,'comunidad')",[$userId]);
    }
    $chiara=query_one("SELECT id FROM users WHERE LOWER(username)='chiara' LIMIT 1");
    if($chiara) execute_sql("INSERT IGNORE INTO user_app_access (user_id,app_code) VALUES (?,'comunidad')",[(int)$chiara['id']]);
}


/**
 * Módulo comercial Apiario La Ruda. Mantiene catálogo, stock, pedidos y etapas
 * de producción sin alterar compras, materiales ni contabilidad apícola.
 */
function ensure_la_ruda_schema(): void
{
    if (!table_exists('users')) return;
    $statements = [
        "CREATE TABLE IF NOT EXISTS la_ruda_products (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(180) NOT NULL, slug VARCHAR(190) NOT NULL, business_line ENUM('apiario','insumos') NOT NULL DEFAULT 'insumos', production_mode ENUM('por_pedido','stock') NOT NULL DEFAULT 'por_pedido', unit VARCHAR(40) NOT NULL DEFAULT 'unidad', stock_quantity DECIMAL(12,3) NOT NULL DEFAULT 0, minimum_stock DECIMAL(12,3) NOT NULL DEFAULT 0, notes TEXT NULL, active TINYINT(1) NOT NULL DEFAULT 1, sort_order INT NOT NULL DEFAULT 100, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uk_la_ruda_products_slug (slug), INDEX idx_la_ruda_products_line (business_line,active,sort_order)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS la_ruda_product_stages (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, product_id INT UNSIGNED NOT NULL, name VARCHAR(180) NOT NULL, sort_order INT NOT NULL DEFAULT 100, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_la_ruda_stage_product FOREIGN KEY (product_id) REFERENCES la_ruda_products(id) ON DELETE CASCADE, UNIQUE KEY uk_la_ruda_stage_product_name (product_id,name), INDEX idx_la_ruda_stage_sort (product_id,sort_order)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS la_ruda_orders (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, customer_name VARCHAR(180) NOT NULL, customer_contact VARCHAR(180) NULL, order_date DATE NOT NULL, due_date DATE NULL, status ENUM('ingresado','produccion','listo','entregado','cancelado') NOT NULL DEFAULT 'ingresado', notes TEXT NULL, created_by_user_id INT UNSIGNED NULL, delivered_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_la_ruda_order_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_la_ruda_order_status_date (status,due_date,order_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS la_ruda_order_items (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, order_id INT UNSIGNED NOT NULL, product_id INT UNSIGNED NOT NULL, quantity DECIMAL(12,3) NOT NULL DEFAULT 1, unit_price DECIMAL(15,2) NOT NULL DEFAULT 0, notes TEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_la_ruda_item_order FOREIGN KEY (order_id) REFERENCES la_ruda_orders(id) ON DELETE CASCADE, CONSTRAINT fk_la_ruda_item_product FOREIGN KEY (product_id) REFERENCES la_ruda_products(id), INDEX idx_la_ruda_item_order (order_id), INDEX idx_la_ruda_item_product (product_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS la_ruda_order_stage_progress (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, order_item_id INT UNSIGNED NOT NULL, stage_id INT UNSIGNED NOT NULL, completed TINYINT(1) NOT NULL DEFAULT 0, completed_at DATETIME NULL, completed_by_user_id INT UNSIGNED NULL, notes VARCHAR(255) NULL, CONSTRAINT fk_la_ruda_progress_item FOREIGN KEY (order_item_id) REFERENCES la_ruda_order_items(id) ON DELETE CASCADE, CONSTRAINT fk_la_ruda_progress_stage FOREIGN KEY (stage_id) REFERENCES la_ruda_product_stages(id) ON DELETE CASCADE, CONSTRAINT fk_la_ruda_progress_user FOREIGN KEY (completed_by_user_id) REFERENCES users(id) ON DELETE SET NULL, UNIQUE KEY uk_la_ruda_progress_item_stage (order_item_id,stage_id), INDEX idx_la_ruda_progress_done (order_item_id,completed)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS la_ruda_stock_movements (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, product_id INT UNSIGNED NOT NULL, movement_date DATE NOT NULL, movement_type ENUM('entrada','salida','ajuste') NOT NULL DEFAULT 'ajuste', quantity_change DECIMAL(12,3) NOT NULL, notes TEXT NULL, order_item_id INT UNSIGNED NULL, created_by_user_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_la_ruda_stock_product FOREIGN KEY (product_id) REFERENCES la_ruda_products(id), CONSTRAINT fk_la_ruda_stock_item FOREIGN KEY (order_item_id) REFERENCES la_ruda_order_items(id) ON DELETE SET NULL, CONSTRAINT fk_la_ruda_stock_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_la_ruda_stock_product_date (product_id,movement_date,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS la_ruda_production_batches (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, product_id INT UNSIGNED NOT NULL, production_date DATE NOT NULL, quantity INT UNSIGNED NOT NULL, grams_per_unit INT UNSIGNED NOT NULL, total_grams INT UNSIGNED NOT NULL, material_price_per_kg_ars DECIMAL(15,2) NOT NULL, usd_rate DECIMAL(15,4) NOT NULL, material_cost_ars DECIMAL(15,2) NOT NULL, material_cost_usd DECIMAL(15,4) NOT NULL, status ENUM('en_proceso','terminada','cancelada') NOT NULL DEFAULT 'en_proceso', notes TEXT NULL, created_by_user_id INT UNSIGNED NULL, completed_by_user_id INT UNSIGNED NULL, completed_at DATETIME NULL, stock_movement_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_la_ruda_batch_product FOREIGN KEY (product_id) REFERENCES la_ruda_products(id), CONSTRAINT fk_la_ruda_batch_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, CONSTRAINT fk_la_ruda_batch_completed FOREIGN KEY (completed_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_la_ruda_batch_status_date (status,production_date), INDEX idx_la_ruda_batch_product (product_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS la_ruda_production_stage_progress (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, batch_id INT UNSIGNED NOT NULL, stage_name VARCHAR(180) NOT NULL, sort_order INT NOT NULL DEFAULT 100, completed TINYINT(1) NOT NULL DEFAULT 0, completed_at DATETIME NULL, completed_by_user_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_la_ruda_batch_stage_batch FOREIGN KEY (batch_id) REFERENCES la_ruda_production_batches(id) ON DELETE CASCADE, CONSTRAINT fk_la_ruda_batch_stage_user FOREIGN KEY (completed_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_la_ruda_batch_stage (batch_id,sort_order)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS la_ruda_sales (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, product_id INT UNSIGNED NOT NULL, sale_date DATE NOT NULL, quantity INT UNSIGNED NOT NULL, unit_sale_price_ars DECIMAL(15,2) NOT NULL, total_sale_ars DECIMAL(15,2) NOT NULL, usd_rate DECIMAL(15,4) NOT NULL, total_sale_usd DECIMAL(15,4) NOT NULL, material_cost_recovered_ars DECIMAL(15,2) NOT NULL DEFAULT 0, material_cost_recovered_usd DECIMAL(15,4) NOT NULL DEFAULT 0, profit_ars DECIMAL(15,2) NOT NULL DEFAULT 0, profit_usd DECIMAL(15,4) NOT NULL DEFAULT 0, buyer VARCHAR(180) NULL, notes TEXT NULL, chiara_accounting_entry_id INT UNSIGNED NULL, general_accounting_entry_id INT UNSIGNED NULL, created_by_user_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_la_ruda_sale_product FOREIGN KEY (product_id) REFERENCES la_ruda_products(id), CONSTRAINT fk_la_ruda_sale_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_la_ruda_sale_date (sale_date), INDEX idx_la_ruda_sale_product (product_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS la_ruda_3d_models (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(180) NOT NULL, product_id INT UNSIGNED NULL, category_name VARCHAR(120) NULL, version_label VARCHAR(80) NULL, description TEXT NULL, original_name VARCHAR(255) NOT NULL, relative_path VARCHAR(500) NOT NULL, mime_type VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream', file_extension VARCHAR(20) NOT NULL, size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0, created_by_user_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_la_ruda_model_product FOREIGN KEY (product_id) REFERENCES la_ruda_products(id) ON DELETE SET NULL, CONSTRAINT fk_la_ruda_model_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_la_ruda_model_product (product_id), INDEX idx_la_ruda_model_category (category_name), INDEX idx_la_ruda_model_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    ];
    foreach ($statements as $sql) db()->exec($sql);

    if (!column_exists('la_ruda_orders', 'calendar_event_id')) db()->exec('ALTER TABLE la_ruda_orders ADD COLUMN calendar_event_id INT UNSIGNED NULL AFTER delivered_at');
    if (!index_exists('la_ruda_orders', 'idx_la_ruda_order_calendar')) db()->exec('ALTER TABLE la_ruda_orders ADD INDEX idx_la_ruda_order_calendar (calendar_event_id)');
    if (!column_exists('la_ruda_order_items', 'manufacturing_completed_at')) db()->exec('ALTER TABLE la_ruda_order_items ADD COLUMN manufacturing_completed_at DATETIME NULL AFTER notes');
    if (!column_exists('la_ruda_order_items', 'manufacturing_completed_by_user_id')) db()->exec('ALTER TABLE la_ruda_order_items ADD COLUMN manufacturing_completed_by_user_id INT UNSIGNED NULL AFTER manufacturing_completed_at');
    if (!column_exists('la_ruda_order_items', 'stock_movement_id')) db()->exec('ALTER TABLE la_ruda_order_items ADD COLUMN stock_movement_id INT UNSIGNED NULL AFTER manufacturing_completed_by_user_id');
    if (!index_exists('la_ruda_order_items', 'idx_la_ruda_item_manufacturing')) db()->exec('ALTER TABLE la_ruda_order_items ADD INDEX idx_la_ruda_item_manufacturing (manufacturing_completed_at,product_id)');

    $productColumns = [
        'category_name' => "ALTER TABLE la_ruda_products ADD COLUMN category_name VARCHAR(120) NULL AFTER slug",
        'grams_per_unit' => "ALTER TABLE la_ruda_products ADD COLUMN grams_per_unit INT UNSIGNED NOT NULL DEFAULT 0 AFTER unit",
        'photo_original_name' => "ALTER TABLE la_ruda_products ADD COLUMN photo_original_name VARCHAR(255) NULL AFTER notes",
        'photo_relative_path' => "ALTER TABLE la_ruda_products ADD COLUMN photo_relative_path VARCHAR(500) NULL AFTER photo_original_name",
        'photo_mime_type' => "ALTER TABLE la_ruda_products ADD COLUMN photo_mime_type VARCHAR(100) NULL AFTER photo_relative_path",
        'sale_price_ars' => "ALTER TABLE la_ruda_products ADD COLUMN sale_price_ars DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER minimum_stock",
        'published_active' => "ALTER TABLE la_ruda_products ADD COLUMN published_active TINYINT(1) NOT NULL DEFAULT 0 AFTER sale_price_ars",
        'stock_value_ars' => "ALTER TABLE la_ruda_products ADD COLUMN stock_value_ars DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER stock_quantity",
        'stock_value_usd' => "ALTER TABLE la_ruda_products ADD COLUMN stock_value_usd DECIMAL(15,4) NOT NULL DEFAULT 0 AFTER stock_value_ars",
    ];
    foreach ($productColumns as $column => $sql) if (!column_exists('la_ruda_products', $column)) db()->exec($sql);
    if (!column_exists('la_ruda_product_stages', 'active')) db()->exec('ALTER TABLE la_ruda_product_stages ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1 AFTER sort_order');

    $movementColumns = [
        'production_batch_id' => "ALTER TABLE la_ruda_stock_movements ADD COLUMN production_batch_id INT UNSIGNED NULL AFTER order_item_id",
        'sale_id' => "ALTER TABLE la_ruda_stock_movements ADD COLUMN sale_id INT UNSIGNED NULL AFTER production_batch_id",
        'grams_used' => "ALTER TABLE la_ruda_stock_movements ADD COLUMN grams_used INT NOT NULL DEFAULT 0 AFTER sale_id",
        'material_cost_ars' => "ALTER TABLE la_ruda_stock_movements ADD COLUMN material_cost_ars DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER grams_used",
        'material_cost_usd' => "ALTER TABLE la_ruda_stock_movements ADD COLUMN material_cost_usd DECIMAL(15,4) NOT NULL DEFAULT 0 AFTER material_cost_ars",
    ];
    foreach ($movementColumns as $column => $sql) if (!column_exists('la_ruda_stock_movements', $column)) db()->exec($sql);
    if (!index_exists('la_ruda_stock_movements', 'idx_la_ruda_stock_batch')) db()->exec('ALTER TABLE la_ruda_stock_movements ADD INDEX idx_la_ruda_stock_batch (production_batch_id)');
    if (!index_exists('la_ruda_stock_movements', 'idx_la_ruda_stock_sale')) db()->exec('ALTER TABLE la_ruda_stock_movements ADD INDEX idx_la_ruda_stock_sale (sale_id)');
    if (!column_exists('la_ruda_production_batches', 'accounting_entry_id')) db()->exec('ALTER TABLE la_ruda_production_batches ADD COLUMN accounting_entry_id INT UNSIGNED NULL AFTER stock_movement_id');
    $saleShareColumns = [
        'chiara_profit_ars' => "ALTER TABLE la_ruda_sales ADD COLUMN chiara_profit_ars DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER profit_usd",
        'chiara_profit_usd' => "ALTER TABLE la_ruda_sales ADD COLUMN chiara_profit_usd DECIMAL(15,4) NOT NULL DEFAULT 0 AFTER chiara_profit_ars",
        'felipe_profit_ars' => "ALTER TABLE la_ruda_sales ADD COLUMN felipe_profit_ars DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER chiara_profit_usd",
        'felipe_profit_usd' => "ALTER TABLE la_ruda_sales ADD COLUMN felipe_profit_usd DECIMAL(15,4) NOT NULL DEFAULT 0 AFTER felipe_profit_ars",
        'chiara_profit_accounting_entry_id' => "ALTER TABLE la_ruda_sales ADD COLUMN chiara_profit_accounting_entry_id INT UNSIGNED NULL AFTER general_accounting_entry_id",
        'felipe_profit_accounting_entry_id' => "ALTER TABLE la_ruda_sales ADD COLUMN felipe_profit_accounting_entry_id INT UNSIGNED NULL AFTER chiara_profit_accounting_entry_id",
    ];
    foreach ($saleShareColumns as $column => $sql) if (!column_exists('la_ruda_sales', $column)) db()->exec($sql);

    execute_sql("INSERT IGNORE INTO accounting_people (name) VALUES ('Chiara'),('Felipe'),('Apiario La Ruda')");
    execute_sql("INSERT IGNORE INTO accounting_concepts (name,default_type) VALUES ('Recuperación de insumos','ingreso'),('Venta de insumos','ingreso'),('Fabricación Apiario La Ruda','egreso')");

    $reset = query_one("SELECT setting_value FROM app_settings WHERE setting_key='la_ruda_v17_catalog_reset'");
    if (!$reset) {
        $seeded = ['nucleo-productivo','celda-real','jaula-enrollable','jaula-reina','nucleo-baby','alimentador-abejas','colmena-escritorio','reposa-cuadros','colmena-escritorio-banco','soporte-colgar-marcos','jaula-reina-acido-oxalico'];
        $marks = implode(',', array_fill(0, count($seeded), '?'));
        execute_sql("UPDATE la_ruda_products SET active=0,published_active=0 WHERE slug IN ($marks)", $seeded);
        execute_sql("INSERT INTO app_settings (setting_key,setting_value) VALUES ('la_ruda_v17_catalog_reset','1') ON DUPLICATE KEY UPDATE setting_value='1'");
    }

    // Índices de lectura frecuentes. Se crean una sola vez durante la migración de versión.
    $performanceIndexes = [
        ['hives','idx_hives_status','status'],
        ['hive_photos','idx_hive_photos_uploaded','uploaded_at'],
        ['community_hives','idx_community_hives_status','status'],
        ['livestock_cattle','idx_livestock_cattle_birth','birth_date'],
        ['livestock_parcels','idx_livestock_parcels_status','status'],
    ];
    foreach ($performanceIndexes as [$table,$index,$column]) {
        if (table_exists($table) && !index_exists($table,$index)) {
            db()->exec("ALTER TABLE `{$table}` ADD INDEX `{$index}` (`{$column}`)");
        }
    }
}

function purchase_material_notes(array $plan, array $item, int $unitNumber, int $unitCount): string
{
    $parts = [
        'Agregado automáticamente al marcar como realizada la compra: ' . (string)$plan['title'] . '.',
        'Mes planificado: ' . month_label((string)$plan['plan_month']) . '.',
    ];
    if ($unitCount > 1) {
        $parts[] = sprintf('Unidad %d de %d.', $unitNumber, $unitCount);
    }
    if (!empty($item['purchase_place'])) {
        $parts[] = 'Lugar de compra: ' . trim((string)$item['purchase_place']) . '.';
    }
    if (!empty($item['notes'])) {
        $parts[] = 'Detalle: ' . trim((string)$item['notes']);
    }
    return implode(' ', $parts);
}

/**
 * Cierra una compra, marca sus renglones como comprados y genera materiales disponibles.
 * Para cada cantidad entera de hasta 500 crea un registro independiente por unidad, para que
 * luego cada elemento pueda asignarse manualmente a una colmena.
 */
function complete_purchase_plan(int $planId): array
{
    ensure_app_schema();
    if ($planId <= 0) {
        throw new RuntimeException('Compra inválida.');
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $plan = query_one('SELECT * FROM purchase_plans WHERE id=? FOR UPDATE', [$planId]);
        if (!$plan) {
            throw new RuntimeException('La compra planificada no existe.');
        }
        if (($plan['status'] ?? 'pendiente') === 'realizada') {
            throw new RuntimeException('Esta compra ya fue marcada como realizada.');
        }

        $items = query_all('SELECT * FROM purchase_items WHERE plan_id=? ORDER BY id FOR UPDATE', [$planId]);
        if (!$items) {
            throw new RuntimeException('Agregue al menos un elemento antes de marcar la compra como realizada.');
        }

        $created = 0;
        foreach ($items as $item) {
            $quantity = max(1, (int)round((float)$item['quantity']));
            $unitCount = min($quantity, 500);

            for ($unit = 1; $unit <= $unitCount; $unit++) {
                execute_sql(
                    'INSERT INTO materials (name, status, hive_id, notes, source_purchase_plan_id, source_purchase_item_id) VALUES (?, ?, NULL, ?, ?, ?)',
                    [
                        trim((string)$item['item_name']),
                        'disponible',
                        purchase_material_notes($plan, $item, $unit, $unitCount),
                        $planId,
                        (int)$item['id'],
                    ]
                );
                $created++;
            }
            execute_sql('UPDATE purchase_items SET is_purchased=1 WHERE id=?', [(int)$item['id']]);
        }

        execute_sql(
            "UPDATE purchase_plans SET status='realizada', completed_at=NOW(), materials_generated_at=NOW() WHERE id=?",
            [$planId]
        );
        $pdo->commit();
        return ['materials_created' => $created, 'items_count' => count($items)];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

function db_installed(): bool
{
    return table_exists('hives');
}

function auth_installed(): bool
{
    if (!table_exists('users')) {
        return false;
    }
    try {
        return (int)db()->query('SELECT COUNT(*) FROM users WHERE active=1')->fetchColumn() > 0;
    } catch (Throwable) {
        return false;
    }
}

function upload_file(string $field, string $subdir): ?array
{
    if (!isset($_FILES[$field]) || $_FILES[$field]['error'] === UPLOAD_ERR_NO_FILE) {
        return null;
    }

    $file = $_FILES[$field];
    if ($file['error'] !== UPLOAD_ERR_OK) {
        throw new RuntimeException('No se pudo cargar el archivo. Código: ' . $file['error']);
    }

    $config = app_config()['uploads'];
    if ((int)$file['size'] > (int)$config['max_bytes']) {
        throw new RuntimeException('El archivo supera el máximo permitido.');
    }

    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = (string)$finfo->file($file['tmp_name']);
    if (!isset($config['allowed_mimes'][$mime])) {
        throw new RuntimeException('Formato no permitido. Use PDF, JPG, PNG o WEBP.');
    }

    $ext = $config['allowed_mimes'][$mime];
    $storedName = date('Ymd_His') . '_' . bin2hex(random_bytes(8)) . '.' . $ext;
    $relativeDir = 'storage/uploads/' . trim($subdir, '/');
    $absoluteDir = __DIR__ . '/' . $relativeDir;
    if (!is_dir($absoluteDir) && !mkdir($absoluteDir, 0775, true) && !is_dir($absoluteDir)) {
        throw new RuntimeException('No se pudo crear la carpeta de archivos.');
    }

    $destination = $absoluteDir . '/' . $storedName;
    if (!move_uploaded_file($file['tmp_name'], $destination)) {
        throw new RuntimeException('No se pudo guardar el archivo cargado.');
    }

    return [
        'stored_name' => $storedName,
        'original_name' => basename((string)$file['name']),
        'relative_path' => $relativeDir . '/' . $storedName,
        'mime_type' => $mime,
        'size_bytes' => (int)$file['size'],
    ];
}

function delete_uploaded_file(?string $relativePath): void
{
    if (!$relativePath) {
        return;
    }
    $root = realpath(__DIR__ . '/storage/uploads');
    $file = realpath(__DIR__ . '/' . ltrim($relativePath, '/'));
    if ($root && $file && ($file === $root || str_starts_with($file, $root . DIRECTORY_SEPARATOR)) && is_file($file)) {
        @unlink($file);
    }
}

function query_all(string $sql, array $params = []): array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll();
}

function query_one(string $sql, array $params = []): ?array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    $row = $stmt->fetch();
    return $row ?: null;
}

function execute_sql(string $sql, array $params = []): PDOStatement
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt;
}

function require_post(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        exit('Método no permitido.');
    }
}

function safe_return(string $fallback): string
{
    return safe_internal_url((string)($_POST['return_to'] ?? ''), $fallback);
}

function client_ip(): string
{
    $config = app_config()['security'];
    if (!empty($config['trust_cloudflare'])) {
        $cfIp = trim((string)($_SERVER['HTTP_CF_CONNECTING_IP'] ?? ''));
        if (filter_var($cfIp, FILTER_VALIDATE_IP)) {
            return $cfIp;
        }
    }
    $remote = trim((string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'));
    return filter_var($remote, FILTER_VALIDATE_IP) ? $remote : '0.0.0.0';
}

function send_private_file(string $absolutePath, string $mimeType, string $downloadName, bool $inline = true): never
{
    if (!is_file($absolutePath) || !is_readable($absolutePath)) {
        http_response_code(404);
        exit('Archivo inexistente.');
    }

    $safeName = preg_replace('/[^\pL\pN._ -]+/u', '_', $downloadName) ?: 'archivo';
    header('Content-Type: ' . $mimeType);
    header('Content-Length: ' . filesize($absolutePath));
    header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . addslashes($safeName) . '"');
    header('Cache-Control: private, no-store, max-age=0');
    header('Pragma: no-cache');
    header('X-Content-Type-Options: nosniff');
    readfile($absolutePath);
    exit;
}


/**
 * Módulos compartidos v12: documentos, crianza de reinas y contabilidad privada.
 * Todas las tablas son idempotentes y los accesos se validan en la API.
 */
function ensure_shared_management_schema(): void
{
    if (!table_exists('users')) return;

    db()->exec("CREATE TABLE IF NOT EXISTS management_documents (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        app_code VARCHAR(40) NOT NULL,
        title VARCHAR(180) NOT NULL,
        category VARCHAR(80) NOT NULL DEFAULT 'otro',
        document_number VARCHAR(120) NULL,
        issuer VARCHAR(180) NULL,
        issue_date DATE NULL,
        expiry_date DATE NULL,
        notes TEXT NULL,
        original_name VARCHAR(255) NOT NULL,
        relative_path VARCHAR(500) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
        uploaded_by_user_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_management_documents_user FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_management_documents_app_category (app_code, category),
        INDEX idx_management_documents_app_expiry (app_code, expiry_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    db()->exec("CREATE TABLE IF NOT EXISTS queen_rearing_batches (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        app_code VARCHAR(40) NOT NULL,
        name VARCHAR(180) NOT NULL,
        source_hive_id INT UNSIGNED NULL,
        location VARCHAR(180) NULL,
        start_point ENUM('huevo','traslarve','celda_operculada') NOT NULL DEFAULT 'traslarve',
        start_date DATE NOT NULL,
        estimated_days SMALLINT UNSIGNED NOT NULL DEFAULT 12,
        expected_emergence_date DATE NOT NULL,
        projected_queens INT UNSIGNED NOT NULL DEFAULT 0,
        emerged_queens INT UNSIGNED NULL,
        formed_hives INT UNSIGNED NULL,
        status ENUM('planificada','en_proceso','nacidas','finalizada','cancelada') NOT NULL DEFAULT 'en_proceso',
        notes TEXT NULL,
        calendar_event_id INT UNSIGNED NULL,
        created_by_user_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_queen_rearing_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_queen_rearing_app_status (app_code, status),
        INDEX idx_queen_rearing_expected (app_code, expected_emergence_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    if (!column_exists('queen_rearing_batches', 'completed_at')) {
        db()->exec('ALTER TABLE queen_rearing_batches ADD COLUMN completed_at DATETIME NULL AFTER calendar_event_id');
    }

    db()->exec("CREATE TABLE IF NOT EXISTS user_navigation_preferences (
        user_id INT UNSIGNED NOT NULL,
        app_code VARCHAR(40) NOT NULL,
        items_json TEXT NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, app_code),
        CONSTRAINT fk_user_navigation_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_navigation_preferences_app (app_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    db()->exec("CREATE TABLE IF NOT EXISTS community_personal_accounting_entries (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        owner_user_id INT UNSIGNED NOT NULL,
        entry_date DATE NOT NULL,
        movement_type ENUM('ingreso','egreso') NOT NULL,
        concept_id INT UNSIGNED NOT NULL,
        amount_ars DECIMAL(15,2) NOT NULL,
        usd_rate DECIMAL(15,4) NOT NULL,
        amount_usd DECIMAL(15,4) NOT NULL,
        description TEXT NULL,
        receipt_original_name VARCHAR(255) NULL,
        receipt_relative_path VARCHAR(500) NULL,
        receipt_mime_type VARCHAR(100) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_community_personal_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_community_personal_concept FOREIGN KEY (concept_id) REFERENCES community_accounting_concepts(id),
        INDEX idx_community_personal_owner_date (owner_user_id, entry_date),
        INDEX idx_community_personal_owner_type (owner_user_id, movement_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    if (table_exists('community_backup_history') && !column_exists('community_backup_history', 'created_by_user_id')) {
        db()->exec('ALTER TABLE community_backup_history ADD COLUMN created_by_user_id INT UNSIGNED NULL AFTER size_bytes');
        db()->exec('ALTER TABLE community_backup_history ADD INDEX idx_community_backup_owner (created_by_user_id, created_at)');
    }
}


/**
 * Manejo técnico apícola v23: temporadas, inspecciones, cosechas,
 * sanidad, alimentación y comparación productiva por colmena.
 */
function ensure_apiculture_management_schema(): void
{
    if (!table_exists('hives') || !table_exists('users')) return;

    db()->exec("CREATE TABLE IF NOT EXISTS apiary_seasons (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 0,
        notes TEXT NULL,
        created_by_user_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_apiary_seasons_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE KEY uk_apiary_seasons_name (name),
        INDEX idx_apiary_seasons_dates (start_date,end_date),
        INDEX idx_apiary_seasons_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    if (!(int)(query_one('SELECT COUNT(*) total FROM apiary_seasons')['total'] ?? 0)) {
        $year=(int)date('Y'); $month=(int)date('n');
        $startYear=$month>=7?$year:$year-1; $endYear=$startYear+1;
        execute_sql('INSERT INTO apiary_seasons (name,start_date,end_date,is_active,notes) VALUES (?,?,?,?,?)',[
            sprintf('%d/%02d',$startYear,$endYear%100), sprintf('%04d-07-01',$startYear), sprintf('%04d-06-30',$endYear), 1,
            'Temporada creada automáticamente al habilitar el manejo técnico.'
        ]);
    }

    db()->exec("CREATE TABLE IF NOT EXISTS hive_inspections (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        hive_id INT UNSIGNED NOT NULL,
        season_id INT UNSIGNED NULL,
        inspection_date DATE NOT NULL,
        queen_seen TINYINT(1) NOT NULL DEFAULT 0,
        laying_status VARCHAR(40) NOT NULL DEFAULT 'sin_evaluar',
        frames_bees SMALLINT UNSIGNED NULL,
        frames_open_brood SMALLINT UNSIGNED NULL,
        frames_capped_brood SMALLINT UNSIGNED NULL,
        honey_reserve_frames SMALLINT UNSIGNED NULL,
        pollen_reserve_frames SMALLINT UNSIGNED NULL,
        honey_reserve_status VARCHAR(30) NULL,
        pollen_reserve_status VARCHAR(30) NULL,
        queen_cells SMALLINT UNSIGNED NULL,
        temperament VARCHAR(40) NULL,
        swarm_signs TINYINT(1) NOT NULL DEFAULT 0,
        health_signs TEXT NULL,
        supers_count SMALLINT UNSIGNED NULL,
        notes TEXT NULL,
        created_by_user_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_hive_inspections_hive FOREIGN KEY (hive_id) REFERENCES hives(id) ON DELETE CASCADE,
        CONSTRAINT fk_hive_inspections_season FOREIGN KEY (season_id) REFERENCES apiary_seasons(id) ON DELETE SET NULL,
        CONSTRAINT fk_hive_inspections_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_hive_inspections_hive_date (hive_id,inspection_date),
        INDEX idx_hive_inspections_season_date (season_id,inspection_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    if (table_exists('hive_inspections') && !column_exists('hive_inspections','honey_reserve_status')) {
        db()->exec("ALTER TABLE hive_inspections ADD COLUMN honey_reserve_status VARCHAR(30) NULL AFTER pollen_reserve_frames");
        execute_sql("UPDATE hive_inspections SET honey_reserve_status=CASE WHEN honey_reserve_frames IS NULL THEN NULL WHEN honey_reserve_frames>=5 THEN 'buena' WHEN honey_reserve_frames>=3 THEN 'ok' WHEN honey_reserve_frames>=1 THEN 'escasa' ELSE 'insuficiente' END WHERE honey_reserve_status IS NULL");
    }
    if (table_exists('hive_inspections') && !column_exists('hive_inspections','pollen_reserve_status')) {
        db()->exec("ALTER TABLE hive_inspections ADD COLUMN pollen_reserve_status VARCHAR(30) NULL AFTER honey_reserve_status");
        execute_sql("UPDATE hive_inspections SET pollen_reserve_status=CASE WHEN pollen_reserve_frames IS NULL THEN NULL WHEN pollen_reserve_frames>=5 THEN 'buena' WHEN pollen_reserve_frames>=3 THEN 'ok' WHEN pollen_reserve_frames>=1 THEN 'escasa' ELSE 'insuficiente' END WHERE pollen_reserve_status IS NULL");
    }

    db()->exec("CREATE TABLE IF NOT EXISTS hive_inspection_files (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        inspection_id INT UNSIGNED NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        relative_path VARCHAR(500) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
        uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_hive_inspection_files_inspection FOREIGN KEY (inspection_id) REFERENCES hive_inspections(id) ON DELETE CASCADE,
        INDEX idx_hive_inspection_files_inspection (inspection_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    db()->exec("CREATE TABLE IF NOT EXISTS apiary_harvests (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        season_id INT UNSIGNED NULL,
        harvest_date DATE NOT NULL,
        batch_code VARCHAR(100) NULL,
        honey_type VARCHAR(120) NULL,
        total_kg DECIMAL(12,3) NOT NULL DEFAULT 0,
        moisture_pct DECIMAL(6,2) NULL,
        containers VARCHAR(180) NULL,
        notes TEXT NULL,
        created_by_user_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_apiary_harvests_season FOREIGN KEY (season_id) REFERENCES apiary_seasons(id) ON DELETE SET NULL,
        CONSTRAINT fk_apiary_harvests_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_apiary_harvests_season_date (season_id,harvest_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    db()->exec("CREATE TABLE IF NOT EXISTS apiary_harvest_hives (
        harvest_id INT UNSIGNED NOT NULL,
        hive_id INT UNSIGNED NOT NULL,
        attributed_kg DECIMAL(12,3) NOT NULL DEFAULT 0,
        PRIMARY KEY (harvest_id,hive_id),
        CONSTRAINT fk_apiary_harvest_hives_harvest FOREIGN KEY (harvest_id) REFERENCES apiary_harvests(id) ON DELETE CASCADE,
        CONSTRAINT fk_apiary_harvest_hives_hive FOREIGN KEY (hive_id) REFERENCES hives(id) ON DELETE CASCADE,
        INDEX idx_apiary_harvest_hives_hive (hive_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    db()->exec("CREATE TABLE IF NOT EXISTS apiary_health_records (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        season_id INT UNSIGNED NULL,
        record_date DATE NOT NULL,
        treatment_type VARCHAR(80) NOT NULL,
        condition_name VARCHAR(140) NULL,
        product VARCHAR(180) NULL,
        dose VARCHAR(120) NULL,
        end_date DATE NULL,
        result VARCHAR(180) NULL,
        notes TEXT NULL,
        created_by_user_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_apiary_health_season FOREIGN KEY (season_id) REFERENCES apiary_seasons(id) ON DELETE SET NULL,
        CONSTRAINT fk_apiary_health_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_apiary_health_season_date (season_id,record_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    db()->exec("CREATE TABLE IF NOT EXISTS apiary_health_hives (
        health_record_id INT UNSIGNED NOT NULL,
        hive_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (health_record_id,hive_id),
        CONSTRAINT fk_apiary_health_hives_record FOREIGN KEY (health_record_id) REFERENCES apiary_health_records(id) ON DELETE CASCADE,
        CONSTRAINT fk_apiary_health_hives_hive FOREIGN KEY (hive_id) REFERENCES hives(id) ON DELETE CASCADE,
        INDEX idx_apiary_health_hives_hive (hive_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    db()->exec("CREATE TABLE IF NOT EXISTS apiary_feedings (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        season_id INT UNSIGNED NULL,
        feeding_date DATE NOT NULL,
        feed_type VARCHAR(100) NOT NULL,
        quantity_per_hive DECIMAL(12,3) NOT NULL DEFAULT 0,
        unit VARCHAR(20) NOT NULL DEFAULT 'kg',
        reason VARCHAR(180) NULL,
        notes TEXT NULL,
        created_by_user_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_apiary_feedings_season FOREIGN KEY (season_id) REFERENCES apiary_seasons(id) ON DELETE SET NULL,
        CONSTRAINT fk_apiary_feedings_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_apiary_feedings_season_date (season_id,feeding_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    db()->exec("CREATE TABLE IF NOT EXISTS apiary_feeding_hives (
        feeding_id INT UNSIGNED NOT NULL,
        hive_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (feeding_id,hive_id),
        CONSTRAINT fk_apiary_feeding_hives_record FOREIGN KEY (feeding_id) REFERENCES apiary_feedings(id) ON DELETE CASCADE,
        CONSTRAINT fk_apiary_feeding_hives_hive FOREIGN KEY (hive_id) REFERENCES hives(id) ON DELETE CASCADE,
        INDEX idx_apiary_feeding_hives_hive (hive_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}
