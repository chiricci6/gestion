SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;


CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(80) NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    last_login_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_app_access (
    user_id INT UNSIGNED NOT NULL,
    app_code VARCHAR(40) NOT NULL,
    granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, app_code),
    INDEX idx_user_app_access_app (app_code),
    CONSTRAINT fk_user_app_access_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username_normalized VARCHAR(80) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_login_attempts_lookup (username_normalized, ip_address, attempted_at),
    INDEX idx_login_attempts_date (attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hives (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    status ENUM('activa','inactiva','observacion','baja') NOT NULL DEFAULT 'activa',
    creation_date DATE NOT NULL,
    queen_year SMALLINT UNSIGNED NULL,
    cover_photo_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_hives_name (name),
    INDEX idx_hives_cover_photo (cover_photo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hive_queen_history (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    hive_id INT UNSIGNED NOT NULL,
    queen_year SMALLINT UNSIGNED NOT NULL,
    change_date DATE NOT NULL,
    notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_hive_queen_history_hive FOREIGN KEY (hive_id) REFERENCES hives(id) ON DELETE CASCADE,
    INDEX idx_hive_queen_history_date (hive_id, change_date, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS apiculture_banner (
    id TINYINT UNSIGNED PRIMARY KEY,
    original_name VARCHAR(255) NULL,
    relative_path VARCHAR(500) NULL,
    mime_type VARCHAR(100) NULL,
    caption VARCHAR(255) NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO apiculture_banner (id, caption) VALUES (1, 'Vista general del apiario');

CREATE TABLE IF NOT EXISTS hive_notes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    hive_id INT UNSIGNED NOT NULL,
    note TEXT NOT NULL,
    note_date DATE NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_hive_notes_hive FOREIGN KEY (hive_id) REFERENCES hives(id) ON DELETE CASCADE,
    INDEX idx_hive_notes_hive_date (hive_id, note_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hive_photos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    hive_id INT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    relative_path VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    caption VARCHAR(255) NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_hive_photos_hive FOREIGN KEY (hive_id) REFERENCES hives(id) ON DELETE CASCADE,
    INDEX idx_hive_photos_hive (hive_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS material_categories (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 100,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_material_categories_name (name),
    INDEX idx_material_categories_order (sort_order,name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS materials (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'Otros materiales',
    photo_original_name VARCHAR(255) NULL,
    photo_relative_path VARCHAR(500) NULL,
    photo_mime_type VARCHAR(100) NULL,
    status ENUM('disponible','en_uso','reparacion') NOT NULL DEFAULT 'disponible',
    hive_id INT UNSIGNED NULL,
    notes TEXT NULL,
    source_purchase_plan_id INT UNSIGNED NULL,
    source_purchase_item_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_materials_hive FOREIGN KEY (hive_id) REFERENCES hives(id) ON DELETE SET NULL,
    INDEX idx_materials_status (status),
    INDEX idx_materials_category (category),
    INDEX idx_materials_hive (hive_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_statuses (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    slug VARCHAR(50) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    color VARCHAR(20) NOT NULL DEFAULT '#64748b',
    is_closed TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uk_activity_statuses_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_labels (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    color VARCHAR(20) NOT NULL DEFAULT '#f4b942',
    UNIQUE KEY uk_activity_labels_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activities (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(180) NOT NULL,
    description TEXT NULL,
    hive_id INT UNSIGNED NULL,
    responsible VARCHAR(120) NULL,
    status_id INT UNSIGNED NOT NULL,
    label_id INT UNSIGNED NULL,
    priority ENUM('baja','normal','alta','urgente') NOT NULL DEFAULT 'normal',
    due_date DATE NULL,
    position INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    CONSTRAINT fk_activities_hive FOREIGN KEY (hive_id) REFERENCES hives(id) ON DELETE SET NULL,
    CONSTRAINT fk_activities_status FOREIGN KEY (status_id) REFERENCES activity_statuses(id),
    CONSTRAINT fk_activities_label FOREIGN KEY (label_id) REFERENCES activity_labels(id) ON DELETE SET NULL,
    INDEX idx_activities_status_position (status_id, position),
    INDEX idx_activities_hive (hive_id),
    INDEX idx_activities_due_date (due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_attachments (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    activity_id INT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    relative_path VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_activity_attachments_activity FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    INDEX idx_activity_attachments_activity (activity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    activity_id INT UNSIGNED NOT NULL,
    action VARCHAR(120) NOT NULL,
    details TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_activity_logs_activity FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    INDEX idx_activity_logs_activity_date (activity_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_plans (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(180) NOT NULL,
    plan_month DATE NOT NULL,
    notes TEXT NULL,
    status ENUM('pendiente','realizada') NOT NULL DEFAULT 'pendiente',
    completed_at DATETIME NULL,
    materials_generated_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_purchase_plans_month (plan_month),
    INDEX idx_purchase_plans_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_items (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    plan_id INT UNSIGNED NOT NULL,
    item_name VARCHAR(180) NOT NULL,
    quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    purchase_place VARCHAR(180) NULL,
    is_purchased TINYINT(1) NOT NULL DEFAULT 0,
    notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_purchase_items_plan FOREIGN KEY (plan_id) REFERENCES purchase_plans(id) ON DELETE CASCADE,
    INDEX idx_purchase_items_plan (plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accounting_people (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uk_accounting_people_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accounting_concepts (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    default_type ENUM('ingreso','egreso') NOT NULL DEFAULT 'egreso',
    active TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uk_accounting_concepts_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accounting_entries (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    entry_date DATE NOT NULL,
    person_id INT UNSIGNED NOT NULL,
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
    CONSTRAINT fk_accounting_entries_person FOREIGN KEY (person_id) REFERENCES accounting_people(id),
    CONSTRAINT fk_accounting_entries_concept FOREIGN KEY (concept_id) REFERENCES accounting_concepts(id),
    INDEX idx_accounting_entries_date (entry_date),
    INDEX idx_accounting_entries_person (person_id),
    INDEX idx_accounting_entries_type (movement_type),
    INDEX idx_accounting_entries_concept (concept_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS backup_history (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO activity_statuses (id, name, slug, sort_order, color, is_closed) VALUES
(1, 'Pendientes', 'pendientes', 10, '#f59e0b', 0),
(2, 'Haciéndose', 'haciendose', 20, '#3b82f6', 0),
(4, 'Terminadas', 'terminadas', 30, '#10b981', 1);

INSERT IGNORE INTO activity_labels (name, color) VALUES
('Alimento', '#f59e0b'),
('Fusión', '#8b5cf6'),
('Cambio de reina', '#ec4899'),
('Falta cría', '#ef4444'),
('Agregar alza', '#0ea5e9'),
('Sacar alza', '#14b8a6'),
('Celda real', '#d946ef'),
('Caída', '#dc2626'),
('Movimiento', '#6366f1'),
('Materiales', '#64748b'),
('Extracción', '#16a34a'),
('Control sanitario', '#4f8b62');

INSERT IGNORE INTO accounting_people (name) VALUES ('Felipe'), ('Chiara');

INSERT IGNORE INTO accounting_concepts (name, default_type) VALUES
('Insumos', 'egreso'),
('Medicamentos', 'egreso'),
('Venta', 'ingreso'),
('Materiales', 'egreso');

INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES ('project_name', 'Proyecto apícola');


-- ============================================================
-- Gestión Ganadera (aplicación separada dentro del mismo acceso)
-- ============================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS app_code VARCHAR(40) NOT NULL DEFAULT 'apicultura' AFTER display_name,
    ADD COLUMN IF NOT EXISTS role VARCHAR(40) NOT NULL DEFAULT 'usuario' AFTER app_code;

CREATE TABLE IF NOT EXISTS livestock_parcels (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(140) NOT NULL,
    area_ha DECIMAL(12,2) NULL,
    status ENUM('disponible','en_uso','descanso','problema') NOT NULL DEFAULT 'disponible',
    rest_start DATE NULL,
    rest_end DATE NULL,
    fence_status ENUM('bien','revisar','reparar') NOT NULL DEFAULT 'bien',
    water_status ENUM('disponible','limitada','sin_agua') NOT NULL DEFAULT 'disponible',
    animal_capacity INT UNSIGNED NULL,
    pasture_type VARCHAR(180) NULL,
    pasture_variety VARCHAR(180) NULL,
    pasture_stage ENUM('sin_pastura','implantacion','crecimiento','vegetativo','floracion','semillado','pastoreo','recuperacion','descanso','degradada') NOT NULL DEFAULT 'sin_pastura',
    pasture_condition ENUM('excelente','buena','regular','mala') NULL,
    pasture_last_update DATE NULL,
    pasture_expected_flowering DATE NULL,
    pasture_grazing_start DATE NULL,
    pasture_grazing_end DATE NULL,
    recommended_rest_days INT UNSIGNED NULL,
    pasture_notes TEXT NULL,
    notes TEXT NULL,
    cover_original_name VARCHAR(255) NULL,
    cover_relative_path VARCHAR(500) NULL,
    cover_mime_type VARCHAR(100) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_livestock_parcels_name (name),
    INDEX idx_livestock_parcels_status (status),
    INDEX idx_livestock_parcels_pasture_stage (pasture_stage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_field_banner (
    id TINYINT UNSIGNED PRIMARY KEY,
    original_name VARCHAR(255) NULL,
    relative_path VARCHAR(500) NULL,
    mime_type VARCHAR(100) NULL,
    caption VARCHAR(255) NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO livestock_field_banner (id, caption) VALUES (1, 'Vista general del campo');


CREATE TABLE IF NOT EXISTS livestock_categories (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(110) NOT NULL,
    color VARCHAR(20) NOT NULL DEFAULT '#64748b',
    description TEXT NULL,
    market_group TINYINT(1) NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 100,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_livestock_categories_name (name),
    UNIQUE KEY uk_livestock_categories_slug (slug),
    INDEX idx_livestock_categories_active_sort (active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_cattle (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tag_number VARCHAR(80) NOT NULL,
    name VARCHAR(120) NULL,
    sex ENUM('hembra','macho') NOT NULL DEFAULT 'hembra',
    category VARCHAR(100) NULL,
    category_id INT UNSIGNED NULL,
    breed VARCHAR(120) NULL,
    birth_date DATE NULL,
    entry_date DATE NOT NULL,
    status ENUM('activo','vendido','muerto','retirado') NOT NULL DEFAULT 'activo',
    parcel_id INT UNSIGNED NULL,
    weight_kg DECIMAL(10,2) NULL,
    body_condition_score DECIMAL(3,1) NULL,
    body_condition_date DATE NULL,
    market_status ENUM('no','observacion','seleccionado','listo') NOT NULL DEFAULT 'no',
    market_date DATE NULL,
    notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_livestock_cattle_tag (tag_number),
    CONSTRAINT fk_livestock_cattle_parcel FOREIGN KEY (parcel_id) REFERENCES livestock_parcels(id) ON DELETE SET NULL,
    CONSTRAINT fk_livestock_cattle_category FOREIGN KEY (category_id) REFERENCES livestock_categories(id) ON DELETE SET NULL,
    INDEX idx_livestock_cattle_status (status),
    INDEX idx_livestock_cattle_parcel (parcel_id),
    INDEX idx_livestock_cattle_category (category_id),
    INDEX idx_livestock_cattle_market (market_status),
    INDEX idx_livestock_cattle_body_condition (body_condition_score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_cattle_notes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cattle_id INT UNSIGNED NOT NULL,
    note_date DATE NOT NULL,
    note TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_livestock_notes_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE,
    INDEX idx_livestock_notes_date (cattle_id, note_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_cattle_photos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cattle_id INT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    relative_path VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    caption VARCHAR(255) NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_livestock_photos_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE,
    INDEX idx_livestock_photos_cattle (cattle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_health_records (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cattle_id INT UNSIGNED NOT NULL,
    batch_id INT UNSIGNED NULL,
    record_date DATE NOT NULL,
    record_type ENUM('vacunacion','tratamiento','control','enfermedad','servicio','parto','desparasitacion','revision_reproductiva','otro') NOT NULL DEFAULT 'control',
    description TEXT NOT NULL,
    product VARCHAR(180) NULL,
    dose VARCHAR(100) NULL,
    professional VARCHAR(160) NULL,
    next_date DATE NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_livestock_health_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE,
    INDEX idx_livestock_health_date (cattle_id, record_date),
    INDEX idx_livestock_health_next (next_date),
    INDEX idx_livestock_health_batch (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_health_batches (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    record_date DATE NOT NULL,
    record_type ENUM('vacunacion','tratamiento','control','enfermedad','servicio','parto','desparasitacion','revision_reproductiva','otro') NOT NULL DEFAULT 'control',
    description TEXT NOT NULL,
    product VARCHAR(180) NULL,
    dose VARCHAR(100) NULL,
    professional VARCHAR(160) NULL,
    next_date DATE NULL,
    category_id INT UNSIGNED NULL,
    scope_label VARCHAR(255) NULL,
    animal_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_livestock_health_batch_category FOREIGN KEY (category_id) REFERENCES livestock_categories(id) ON DELETE SET NULL,
    INDEX idx_livestock_health_batches_date (record_date),
    INDEX idx_livestock_health_batches_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_health_batch_cattle (
    batch_id INT UNSIGNED NOT NULL,
    cattle_id INT UNSIGNED NOT NULL,
    health_record_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (batch_id, cattle_id),
    CONSTRAINT fk_livestock_batch_cattle_batch FOREIGN KEY (batch_id) REFERENCES livestock_health_batches(id) ON DELETE CASCADE,
    CONSTRAINT fk_livestock_batch_cattle_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE,
    CONSTRAINT fk_livestock_batch_cattle_record FOREIGN KEY (health_record_id) REFERENCES livestock_health_records(id) ON DELETE CASCADE,
    INDEX idx_livestock_batch_cattle_record (health_record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_health_attachments (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    health_record_id INT UNSIGNED NULL,
    batch_id INT UNSIGNED NULL,
    original_name VARCHAR(255) NOT NULL,
    relative_path VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    caption VARCHAR(255) NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_livestock_health_attachment_record FOREIGN KEY (health_record_id) REFERENCES livestock_health_records(id) ON DELETE CASCADE,
    CONSTRAINT fk_livestock_health_attachment_batch FOREIGN KEY (batch_id) REFERENCES livestock_health_batches(id) ON DELETE CASCADE,
    INDEX idx_livestock_health_attachment_record (health_record_id),
    INDEX idx_livestock_health_attachment_batch (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_body_condition_records (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cattle_id INT UNSIGNED NOT NULL,
    assessment_date DATE NOT NULL,
    score DECIMAL(3,1) NOT NULL,
    notes TEXT NULL,
    is_alert TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_livestock_body_condition_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE,
    INDEX idx_livestock_body_condition_date (cattle_id, assessment_date),
    INDEX idx_livestock_body_condition_alert (is_alert, assessment_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_movements (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cattle_id INT UNSIGNED NOT NULL,
    from_parcel_id INT UNSIGNED NULL,
    to_parcel_id INT UNSIGNED NULL,
    movement_date DATE NOT NULL,
    reason VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_livestock_movements_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE CASCADE,
    CONSTRAINT fk_livestock_movements_from FOREIGN KEY (from_parcel_id) REFERENCES livestock_parcels(id) ON DELETE SET NULL,
    CONSTRAINT fk_livestock_movements_to FOREIGN KEY (to_parcel_id) REFERENCES livestock_parcels(id) ON DELETE SET NULL,
    INDEX idx_livestock_movements_date (cattle_id, movement_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_activity_statuses (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    slug VARCHAR(50) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    color VARCHAR(20) NOT NULL DEFAULT '#64748b',
    is_closed TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uk_livestock_activity_status_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_activity_labels (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    color VARCHAR(20) NOT NULL DEFAULT '#f4b942',
    UNIQUE KEY uk_livestock_activity_label_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_activities (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(180) NOT NULL,
    description TEXT NULL,
    cattle_id INT UNSIGNED NULL,
    parcel_id INT UNSIGNED NULL,
    status_id INT UNSIGNED NOT NULL,
    label_id INT UNSIGNED NULL,
    priority ENUM('baja','normal','alta','urgente') NOT NULL DEFAULT 'normal',
    due_date DATE NULL,
    position INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    CONSTRAINT fk_livestock_activities_cattle FOREIGN KEY (cattle_id) REFERENCES livestock_cattle(id) ON DELETE SET NULL,
    CONSTRAINT fk_livestock_activities_parcel FOREIGN KEY (parcel_id) REFERENCES livestock_parcels(id) ON DELETE SET NULL,
    CONSTRAINT fk_livestock_activities_status FOREIGN KEY (status_id) REFERENCES livestock_activity_statuses(id),
    CONSTRAINT fk_livestock_activities_label FOREIGN KEY (label_id) REFERENCES livestock_activity_labels(id) ON DELETE SET NULL,
    INDEX idx_livestock_activities_status_position (status_id, position),
    INDEX idx_livestock_activities_due (due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_activity_attachments (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    activity_id INT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    relative_path VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_livestock_attachment_activity FOREIGN KEY (activity_id) REFERENCES livestock_activities(id) ON DELETE CASCADE,
    INDEX idx_livestock_attachment_activity (activity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_activity_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    activity_id INT UNSIGNED NOT NULL,
    action VARCHAR(120) NOT NULL,
    details TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_livestock_logs_activity FOREIGN KEY (activity_id) REFERENCES livestock_activities(id) ON DELETE CASCADE,
    INDEX idx_livestock_logs_date (activity_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_accounting_concepts (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    default_type ENUM('ingreso','egreso') NOT NULL DEFAULT 'egreso',
    active TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uk_livestock_concepts_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_accounting_entries (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
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
    CONSTRAINT fk_livestock_accounting_concept FOREIGN KEY (concept_id) REFERENCES livestock_accounting_concepts(id),
    INDEX idx_livestock_accounting_date (entry_date),
    INDEX idx_livestock_accounting_type (movement_type),
    INDEX idx_livestock_accounting_concept (concept_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_rainfall (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rain_date DATE NOT NULL,
    millimeters DECIMAL(10,2) NOT NULL,
    notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_livestock_rainfall_date (rain_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livestock_backup_history (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO livestock_categories (name,slug,color,description,market_group,sort_order) VALUES
('Vaca vacía','vaca-vacia','#9b6b43','Vacas sin preñez confirmada.',0,10),
('En parición','en-paricion','#d97706','Animales próximos al parto o en período de parición.',0,20),
('Seca','seca','#64748b','Vacas fuera de lactancia o en descanso productivo.',0,30),
('CUT','cut','#7c3aed','Categoría CUT según criterio del establecimiento.',0,40),
('Vaquillona','vaquillona','#db2777','Hembras jóvenes antes del primer parto.',0,50),
('Ternero/a','ternero','#0ea5e9','Cría al pie o destetada.',0,60),
('Recría','recria','#059669','Animales en etapa de recría.',0,70),
('Engorde','engorde','#b45309','Animales en terminación o engorde.',0,80),
('Toro','toro','#334155','Machos reproductores.',0,90),
('Salida a mercado','salida-mercado','#dc2626','Animales agrupados para próxima venta o salida.',1,100);

INSERT IGNORE INTO livestock_activity_statuses (id, name, slug, sort_order, color, is_closed) VALUES
(1, 'Pendientes', 'pendientes', 10, '#f59e0b', 0),
(2, 'Haciéndose', 'haciendose', 20, '#3b82f6', 0),
(3, 'Terminadas', 'terminadas', 30, '#10b981', 1);

INSERT IGNORE INTO livestock_activity_labels (name, color) VALUES
('Sanidad', '#dc2626'),
('Vacunación', '#ec4899'),
('Alimentación', '#f59e0b'),
('Movimiento', '#6366f1'),
('Alambrado', '#7856ad'),
('Agua', '#0ea5e9'),
('Pastura', '#16a34a'),
('Pesaje', '#64748b'),
('Revisión', '#3976bd'),
('Compra', '#b97511');

INSERT IGNORE INTO livestock_accounting_concepts (name, default_type) VALUES
('Alimento', 'egreso'),
('Sanidad y medicamentos', 'egreso'),
('Alambrados e infraestructura', 'egreso'),
('Compra de animales', 'egreso'),
('Venta de animales', 'ingreso'),
('Servicios', 'egreso'),
('Otros ingresos', 'ingreso'),
('Otros egresos', 'egreso');

SET FOREIGN_KEY_CHECKS=1;

-- ============================================================
-- Apiario La Ruda v17 · productos propios, fabricación valorizada y ventas
-- ============================================================
ALTER TABLE la_ruda_products
    ADD COLUMN IF NOT EXISTS category_name VARCHAR(120) NULL AFTER slug,
    ADD COLUMN IF NOT EXISTS grams_per_unit INT UNSIGNED NOT NULL DEFAULT 0 AFTER unit,
    ADD COLUMN IF NOT EXISTS stock_value_ars DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER stock_quantity,
    ADD COLUMN IF NOT EXISTS stock_value_usd DECIMAL(15,4) NOT NULL DEFAULT 0 AFTER stock_value_ars,
    ADD COLUMN IF NOT EXISTS sale_price_ars DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER minimum_stock,
    ADD COLUMN IF NOT EXISTS published_active TINYINT(1) NOT NULL DEFAULT 0 AFTER sale_price_ars,
    ADD COLUMN IF NOT EXISTS photo_original_name VARCHAR(255) NULL AFTER notes,
    ADD COLUMN IF NOT EXISTS photo_relative_path VARCHAR(500) NULL AFTER photo_original_name,
    ADD COLUMN IF NOT EXISTS photo_mime_type VARCHAR(100) NULL AFTER photo_relative_path;

ALTER TABLE la_ruda_product_stages
    ADD COLUMN IF NOT EXISTS active TINYINT(1) NOT NULL DEFAULT 1 AFTER sort_order;

CREATE TABLE IF NOT EXISTS la_ruda_production_batches (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    product_id INT UNSIGNED NOT NULL,
    production_date DATE NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    grams_per_unit INT UNSIGNED NOT NULL,
    total_grams INT UNSIGNED NOT NULL,
    material_price_per_kg_ars DECIMAL(15,2) NOT NULL,
    usd_rate DECIMAL(15,4) NOT NULL,
    material_cost_ars DECIMAL(15,2) NOT NULL,
    material_cost_usd DECIMAL(15,4) NOT NULL,
    status ENUM('en_proceso','terminada','cancelada') NOT NULL DEFAULT 'en_proceso',
    notes TEXT NULL,
    created_by_user_id INT UNSIGNED NULL,
    completed_by_user_id INT UNSIGNED NULL,
    completed_at DATETIME NULL,
    stock_movement_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_la_ruda_batch_product FOREIGN KEY (product_id) REFERENCES la_ruda_products(id),
    CONSTRAINT fk_la_ruda_batch_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_la_ruda_batch_completed FOREIGN KEY (completed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_la_ruda_batch_status_date (status,production_date),
    INDEX idx_la_ruda_batch_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS la_ruda_production_stage_progress (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_id INT UNSIGNED NOT NULL,
    stage_name VARCHAR(180) NOT NULL,
    sort_order INT NOT NULL DEFAULT 100,
    completed TINYINT(1) NOT NULL DEFAULT 0,
    completed_at DATETIME NULL,
    completed_by_user_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_la_ruda_batch_stage_batch FOREIGN KEY (batch_id) REFERENCES la_ruda_production_batches(id) ON DELETE CASCADE,
    CONSTRAINT fk_la_ruda_batch_stage_user FOREIGN KEY (completed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_la_ruda_batch_stage (batch_id,sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS la_ruda_sales (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    product_id INT UNSIGNED NOT NULL,
    sale_date DATE NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    unit_sale_price_ars DECIMAL(15,2) NOT NULL,
    total_sale_ars DECIMAL(15,2) NOT NULL,
    usd_rate DECIMAL(15,4) NOT NULL,
    total_sale_usd DECIMAL(15,4) NOT NULL,
    material_cost_recovered_ars DECIMAL(15,2) NOT NULL DEFAULT 0,
    material_cost_recovered_usd DECIMAL(15,4) NOT NULL DEFAULT 0,
    profit_ars DECIMAL(15,2) NOT NULL DEFAULT 0,
    profit_usd DECIMAL(15,4) NOT NULL DEFAULT 0,
    buyer VARCHAR(180) NULL,
    notes TEXT NULL,
    chiara_accounting_entry_id INT UNSIGNED NULL,
    general_accounting_entry_id INT UNSIGNED NULL,
    created_by_user_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_la_ruda_sale_product FOREIGN KEY (product_id) REFERENCES la_ruda_products(id),
    CONSTRAINT fk_la_ruda_sale_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_la_ruda_sale_date (sale_date),
    INDEX idx_la_ruda_sale_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE la_ruda_stock_movements
    ADD COLUMN IF NOT EXISTS production_batch_id INT UNSIGNED NULL AFTER order_item_id,
    ADD COLUMN IF NOT EXISTS sale_id INT UNSIGNED NULL AFTER production_batch_id,
    ADD COLUMN IF NOT EXISTS grams_used INT NOT NULL DEFAULT 0 AFTER sale_id,
    ADD COLUMN IF NOT EXISTS material_cost_ars DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER grams_used,
    ADD COLUMN IF NOT EXISTS material_cost_usd DECIMAL(15,4) NOT NULL DEFAULT 0 AFTER material_cost_ars;

INSERT IGNORE INTO accounting_people (name) VALUES ('Apiario La Ruda');
INSERT IGNORE INTO accounting_concepts (name,default_type) VALUES
('Recuperación de insumos','ingreso'),
('Venta de insumos','ingreso');


-- Gestión Ganadera v20: clasificación, rodeos, reproducción y suelo operativo.
CREATE TABLE IF NOT EXISTS livestock_herds (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(140) NOT NULL, herd_type ENUM('permanente','temporal') NOT NULL DEFAULT 'temporal', purpose VARCHAR(180) NULL, color VARCHAR(20) NOT NULL DEFAULT '#8a6d4a', parcel_id INT UNSIGNED NULL, status ENUM('activo','cerrado') NOT NULL DEFAULT 'activo', notes TEXT NULL, created_by_user_id INT UNSIGNED NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_livestock_herds_status (status,name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS livestock_herd_members (herd_id INT UNSIGNED NOT NULL,cattle_id INT UNSIGNED NOT NULL,active TINYINT(1) NOT NULL DEFAULT 1,added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,removed_at DATETIME NULL,notes VARCHAR(255) NULL,PRIMARY KEY(herd_id,cattle_id),INDEX idx_livestock_herd_members_cattle(cattle_id,active)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS livestock_reproduction_events (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,cattle_id INT UNSIGNED NOT NULL,event_type ENUM('servicio','inseminacion','diagnostico_gestacion','parto','destete','secado','aborto','otro') NOT NULL,event_date DATE NOT NULL,sire_cattle_id INT UNSIGNED NULL,sire_reference VARCHAR(180) NULL,breeding_batch VARCHAR(180) NULL,result VARCHAR(180) NULL,expected_calving_date DATE NULL,calf_cattle_id INT UNSIGNED NULL,health_record_id INT UNSIGNED NULL,notes TEXT NULL,created_by_user_id INT UNSIGNED NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX idx_livestock_repro_cattle_date(cattle_id,event_date,id),INDEX idx_livestock_repro_expected(expected_calving_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS la_ruda_3d_models (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(180) NOT NULL,
    product_id INT UNSIGNED NULL,
    category_name VARCHAR(120) NULL,
    version_label VARCHAR(80) NULL,
    description TEXT NULL,
    original_name VARCHAR(255) NOT NULL,
    relative_path VARCHAR(500) NOT NULL,
    mime_type VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream',
    file_extension VARCHAR(20) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_by_user_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_la_ruda_model_product FOREIGN KEY (product_id) REFERENCES la_ruda_products(id) ON DELETE SET NULL,
    CONSTRAINT fk_la_ruda_model_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_la_ruda_model_product (product_id),
    INDEX idx_la_ruda_model_category (category_name),
    INDEX idx_la_ruda_model_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
