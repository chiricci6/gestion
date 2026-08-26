<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/ganaderia.php';
require_once __DIR__ . '/community.php';
require_once __DIR__ . '/community_management.php';
require_once __DIR__ . '/common_modules.php';
require_once __DIR__ . '/la_ruda.php';
require_once __DIR__ . '/google_calendar.php';
require_once __DIR__ . '/apiculture_management.php';

$action = trim((string)($_GET['action'] ?? $_POST['action'] ?? 'health'));


function ensure_apiculture_activity_labels(): void
{
    execute_sql("INSERT IGNORE INTO activity_labels (name,color) VALUES ('Control sanitario','#4f8b62')");
}

function apiculture_income_allocation(float $amount): array
{
    $amount=max(0.0,$amount);
    $rows=query_all("SELECT p.id,p.name,COALESCE(SUM(CASE WHEN e.movement_type='ingreso' THEN e.amount_ars ELSE -e.amount_ars END),0) balance_ars
        FROM accounting_people p LEFT JOIN accounting_entries e ON e.person_id=p.id
        WHERE LOWER(p.name) IN ('chiara','felipe') GROUP BY p.id,p.name");
    $by=[];
    foreach($rows as $row)$by[mb_strtolower((string)$row['name'])]=$row;
    if(empty($by['chiara'])||empty($by['felipe'])) api_fail('No se encontraron Chiara y Felipe en Contabilidad.');
    $bc=(float)$by['chiara']['balance_ars'];$bf=(float)$by['felipe']['balance_ars'];
    $dc=max(0.0,-$bc);$df=max(0.0,-$bf);$remain=$amount;$c=0.0;$f=0.0;$debt=$dc+$df;
    if($remain>0&&$debt>0){
        $cover=min($remain,$debt);
        if($dc>0&&$df>0){$c+=$cover*$dc/$debt;$f+=$cover*$df/$debt;}
        elseif($dc>0)$c+=$cover;else $f+=$cover;
        $remain-=$cover;
    }
    if($remain>0){$c+=$remain/2;$f+=$remain/2;}
    $c=round($c,2);$f=round($amount-$c,2);
    return [
        ['person_id'=>(int)$by['chiara']['id'],'name'=>'Chiara','balance'=>$bc,'amount'=>$c,'percent'=>$amount>0?$c/$amount*100:0],
        ['person_id'=>(int)$by['felipe']['id'],'name'=>'Felipe','balance'=>$bf,'amount'=>$f,'percent'=>$amount>0?$f/$amount*100:0],
    ];
}

try {
    if ($action === 'google_calendar_callback' || str_starts_with($action, 'google_calendar_')) { google_calendar_handle($action); }

    // Endpoints exclusivos de Gestión Apícola. Evitan que una carga multipart
    // pierda el identificador de aplicación y mantienen Ganadería/Comunidad intactas.
    $apicultureDocumentActions = [
        'apiculture_documents_list' => 'documents_list',
        'apiculture_document_save' => 'document_save',
        'apiculture_document_delete' => 'document_delete',
        'apiculture_document_file' => 'document_file',
    ];
    if (isset($apicultureDocumentActions[$action])) {
        $_GET['app_code'] = 'apicultura';
        common_handle_documents($apicultureDocumentActions[$action]);
    }
    if (in_array($action, ['documents_list','document_save','document_delete','document_file'], true)) { common_handle_documents($action); }
    if (in_array($action, ['navigation_get','navigation_save'], true)) { common_handle_navigation($action); }
    if (in_array($action, ['queen_rearing_list','queen_rearing_save','queen_rearing_close','queen_rearing_delete'], true)) { common_handle_queen_rearing($action); }
    if (str_starts_with($action, 'livestock_')) { livestock_handle($action); }
    if (str_starts_with($action, 'la_ruda_')) { la_ruda_handle($action); }
    if (str_starts_with($action, 'apiary_')) { apiculture_management_handle($action); }
    if (str_starts_with($action, 'community_apiary_')) { community_management_handle($action); }
    if (str_starts_with($action, 'community_')) { community_handle($action); }
    if (str_starts_with($action, 'calendar_')) {
        $calendarApp = trim((string)($_GET['app_code'] ?? $_POST['app_code'] ?? (api_input()['app_code'] ?? 'apicultura')));
        if (!in_array($calendarApp, ['apicultura','ganaderia','comunidad'], true)) api_fail('Aplicación de calendario inválida.');
        $calendarUser = api_require_app($calendarApp);
        if ($action === 'calendar_events') {
            $from = trim((string)($_GET['from'] ?? date('Y-m-01')));
            $to = trim((string)($_GET['to'] ?? date('Y-m-t')));
            $manual = query_all('SELECT e.*,u.display_name created_by_name FROM management_calendar_events e LEFT JOIN users u ON u.id=e.created_by_user_id WHERE e.app_code=? AND e.start_date<=? AND COALESCE(e.end_date,e.start_date)>=? ORDER BY e.start_date,e.id', [$calendarApp,$to,$from]);
            if ($calendarApp === 'apicultura') {
                $activities = query_all("SELECT a.id,a.title,a.due_date start_date,h.name entity_name,s.name status_name,l.name label_name,l.color FROM activities a JOIN activity_statuses s ON s.id=a.status_id LEFT JOIN hives h ON h.id=a.hive_id LEFT JOIN activity_labels l ON l.id=a.label_id WHERE a.due_date BETWEEN ? AND ? ORDER BY a.due_date", [$from,$to]);
            } elseif ($calendarApp === 'ganaderia') {
                $activities = query_all("SELECT a.id,a.title,a.due_date start_date,COALESCE(CONCAT('Caravana ',c.tag_number),p.name) entity_name,s.name status_name,l.name label_name,l.color FROM livestock_activities a JOIN livestock_activity_statuses s ON s.id=a.status_id LEFT JOIN livestock_cattle c ON c.id=a.cattle_id LEFT JOIN livestock_parcels p ON p.id=a.parcel_id LEFT JOIN livestock_activity_labels l ON l.id=a.label_id WHERE a.due_date BETWEEN ? AND ? ORDER BY a.due_date", [$from,$to]);
            } else {
                $activities = query_all("SELECT a.id,a.title,a.due_date start_date,h.name entity_name,s.name status_name,l.name label_name,l.color,u.display_name responsible_name FROM community_activities a JOIN community_activity_statuses s ON s.id=a.status_id LEFT JOIN community_hives h ON h.id=a.hive_id LEFT JOIN community_activity_labels l ON l.id=a.label_id LEFT JOIN users u ON u.id=a.responsible_user_id WHERE a.due_date BETWEEN ? AND ? ORDER BY a.due_date", [$from,$to]);
            }
            api_ok(['events'=>$manual,'activities'=>$activities]);
        }
        if ($action === 'calendar_save') {
            api_require_method('POST'); $data=api_input(); $id=api_int($data,'id'); $title=api_string($data,'title'); $start=api_string($data,'start_date'); if(!$title||!$start) api_fail('Complete título y fecha.');
            $values=[$calendarApp,$title,api_string($data,'event_type','general'),$start,api_string($data,'end_date')?:null,api_string($data,'notes')?:null,api_string($data,'color','#3976bd')];
            if($id) { $updated=execute_sql('UPDATE management_calendar_events SET title=?,event_type=?,start_date=?,end_date=?,notes=?,color=? WHERE id=? AND app_code=?',[$title,api_string($data,'event_type','general'),$start,api_string($data,'end_date')?:null,api_string($data,'notes')?:null,api_string($data,'color','#3976bd'),$id,$calendarApp]); if($updated->rowCount()===0 && !query_one('SELECT id FROM management_calendar_events WHERE id=? AND app_code=?',[$id,$calendarApp])) api_fail('El evento no existe o pertenece a otra aplicación.',404); } else { execute_sql('INSERT INTO management_calendar_events (app_code,title,event_type,start_date,end_date,notes,color,created_by_user_id) VALUES (?,?,?,?,?,?,?,?)',[...$values,(int)$calendarUser['id']]); $id=(int)db()->lastInsertId(); }
            google_calendar_sync_app_best_effort($calendarApp);
            api_ok(['id'=>$id],'Evento guardado.');
        }
        if ($action === 'calendar_delete') { api_require_method('POST'); $data=api_input(); execute_sql('DELETE FROM management_calendar_events WHERE id=? AND app_code=?',[api_int($data,'id',0),$calendarApp]); google_calendar_sync_app_best_effort($calendarApp); api_ok([],'Evento eliminado.'); }
        api_fail('Acción de calendario desconocida.',404);
    }
    if (!in_array($action, ['health', 'login', 'logout', 'me', 'change_password'], true)) { api_require_app('apicultura'); }
    switch ($action) {
        case 'health':
            api_ok([
                'service' => 'Mellifera Technology · API de Gestión',
                'version' => '24.0.0',
                'database_ready' => db_installed() && auth_installed(),
                'server_time' => date(DATE_ATOM),
            ]);

        case 'login':
            api_require_method('POST');
            $data = api_input();
            $username = api_string($data, 'username');
            $password = (string)($data['password'] ?? '');
            if ($username === '' || $password === '') {
                api_fail('Complete usuario y contraseña.');
            }
            $normalized = mb_strtolower($username, 'UTF-8');
            $ip = api_client_ip();
            $window = max(5, (int)env_value('LOGIN_WINDOW_MINUTES', 15));
            $maxAttempts = max(3, (int)env_value('LOGIN_MAX_ATTEMPTS', 5));
            $recentAttempts = query_one(
                sprintf('SELECT COUNT(*) AS total FROM login_attempts WHERE username_normalized=? AND ip_address=? AND attempted_at >= DATE_SUB(NOW(), INTERVAL %d MINUTE)', $window),
                [$normalized, $ip]
            );
            if ((int)($recentAttempts['total'] ?? 0) >= $maxAttempts) {
                api_fail('Demasiados intentos. Espere unos minutos y vuelva a probar.', 429);
            }
            $user = query_one('SELECT * FROM users WHERE LOWER(username)=? AND active=1 LIMIT 1', [$normalized]);
            if (!$user || !password_verify($password, (string)$user['password_hash'])) {
                execute_sql('INSERT INTO login_attempts (username_normalized, ip_address) VALUES (?, ?)', [$normalized, $ip]);
                api_fail('Usuario o contraseña incorrectos.', 401);
            }
            execute_sql('DELETE FROM login_attempts WHERE username_normalized=? AND ip_address=?', [$normalized, $ip]);
            execute_sql('UPDATE users SET last_login_at=NOW() WHERE id=?', [(int)$user['id']]);
            $token = api_issue_token((int)$user['id']);
            api_ok([
                'token' => $token,
                'user' => [
                    'id' => (int)$user['id'],
                    'username' => (string)$user['username'],
                    'display_name' => (string)$user['display_name'],
                    'app_code' => (string)($user['app_code'] ?? 'apicultura'),
                    'apps' => api_user_apps((int)$user['id']),
                    'role' => (string)($user['role'] ?? 'usuario'),
                    'last_login_at' => date('Y-m-d H:i:s'),
                ],
            ], 'Ingreso correcto.');

        case 'logout':
            api_require_method('POST');
            api_user();
            api_delete_current_token();
            api_ok([], 'Sesión cerrada.');

        case 'me':
            $user = api_user();
            api_ok(['user' => [
                'id' => (int)$user['id'],
                'username' => (string)$user['username'],
                'display_name' => (string)$user['display_name'],
                'app_code' => (string)($user['app_code'] ?? 'apicultura'),
                'apps' => api_user_apps((int)$user['id']),
                'role' => (string)($user['role'] ?? 'usuario'),
                'last_login_at' => $user['last_login_at'],
            ]]);

        case 'change_password':
            api_require_method('POST');
            $user = api_user();
            $data = api_input();
            $current = (string)($data['current_password'] ?? '');
            $new = (string)($data['new_password'] ?? '');
            $confirm = (string)($data['new_password_confirm'] ?? '');
            $stored = query_one('SELECT password_hash FROM users WHERE id=?', [(int)$user['id']]);
            if (!$stored || !password_verify($current, (string)$stored['password_hash'])) {
                api_fail('La contraseña actual es incorrecta.');
            }
            if ($new !== $confirm) {
                api_fail('Las dos contraseñas nuevas no coinciden.');
            }
            $error = validate_new_password($new);
            if ($error !== null) {
                api_fail($error);
            }
            execute_sql('UPDATE users SET password_hash=? WHERE id=?', [password_hash($new, PASSWORD_DEFAULT), (int)$user['id']]);
            execute_sql('DELETE FROM api_tokens WHERE user_id=? AND id<>?', [(int)$user['id'], (int)$user['token_id']]);
            api_ok([], 'Contraseña actualizada correctamente.');

        case 'dashboard':
            api_user();
            $balances = query_all(
                "SELECT p.id, p.name,
                        COALESCE(SUM(CASE WHEN e.movement_type='ingreso' THEN e.amount_ars ELSE -e.amount_ars END), 0) AS balance_ars,
                        COALESCE(SUM(CASE WHEN e.movement_type='ingreso' THEN e.amount_usd ELSE -e.amount_usd END), 0) AS balance_usd
                 FROM accounting_people p
                 LEFT JOIN accounting_entries e ON e.person_id=p.id
                 WHERE p.active=1
                 GROUP BY p.id, p.name ORDER BY p.id"
            );
            $stats = [
                'hives' => (int)(query_one('SELECT COUNT(*) AS total FROM hives')['total'] ?? 0),
                'pending_activities' => (int)(query_one("SELECT (SELECT COUNT(*) FROM activities a JOIN activity_statuses s ON s.id=a.status_id WHERE s.is_closed=0) + (SELECT COUNT(*) FROM purchase_plans WHERE status='pendiente') AS total")['total'] ?? 0),
                'materials' => query_one("SELECT COUNT(*) AS total, COALESCE(SUM(status='disponible'),0) AS available, COALESCE(SUM(status='en_uso'),0) AS in_use, COALESCE(SUM(status='reparacion'),0) AS repair FROM materials"),
                'purchase_plans' => query_one("SELECT COUNT(DISTINCT p.id) AS total, COALESCE(SUM(i.quantity*i.unit_price),0) AS amount FROM purchase_plans p LEFT JOIN purchase_items i ON i.plan_id=p.id WHERE p.status='pendiente'"),
                'accounting' => query_one("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN movement_type='ingreso' THEN amount_ars ELSE -amount_ars END),0) AS balance, COALESCE(SUM(CASE WHEN movement_type='ingreso' THEN amount_usd ELSE -amount_usd END),0) AS balance_usd FROM accounting_entries"),
            ];
            $recent = query_all(
                "SELECT a.id, a.title, a.priority, a.due_date, h.name AS hive_name, s.name AS status_name, s.color AS status_color, l.name AS label_name, l.color AS label_color
                 FROM activities a JOIN activity_statuses s ON s.id=a.status_id
                 LEFT JOIN activity_labels l ON l.id=a.label_id LEFT JOIN hives h ON h.id=a.hive_id
                 WHERE s.is_closed=0
                 ORDER BY FIELD(a.priority,'urgente','alta','normal','baja'), a.due_date IS NULL, a.due_date, a.updated_at DESC LIMIT 6"
            );
            $banner = query_one('SELECT id, original_name, mime_type, caption, updated_at, relative_path IS NOT NULL AS has_file FROM apiculture_banner WHERE id=1');
            api_ok(['balances' => $balances, 'stats' => $stats, 'recent_activities' => $recent, 'banner' => $banner]);

        case 'hives':
            api_user();
            $search = trim((string)($_GET['q'] ?? ''));
            $status = trim((string)($_GET['status'] ?? ''));
            $where = [];
            $params = [];
            if ($search !== '') {
                $where[] = 'h.name LIKE ?';
                $params[] = '%' . $search . '%';
            }
            if (in_array($status, ['activa', 'inactiva', 'observacion', 'baja'], true)) {
                $where[] = 'h.status=?';
                $params[] = $status;
            }
            $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
            $hives = query_all(
                "SELECT h.*,
                        COUNT(DISTINCT CASE WHEN s.is_closed=0 THEN a.id END) AS open_activities,
                        COUNT(DISTINCT n.id) AS notes_count,
                        COUNT(DISTINCT p.id) AS photos_count
                 FROM hives h LEFT JOIN activities a ON a.hive_id=h.id LEFT JOIN activity_statuses s ON s.id=a.status_id
                 LEFT JOIN hive_notes n ON n.hive_id=h.id LEFT JOIN hive_photos p ON p.hive_id=h.id
                 {$sqlWhere} GROUP BY h.id
                 ORDER BY FIELD(h.status,'activa','observacion','inactiva','baja'), h.name",
                $params
            );
            api_ok(['hives' => $hives]);

        case 'hive':
            api_user();
            $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT) ?: 0;
            $hive = query_one('SELECT * FROM hives WHERE id=?', [$id]);
            if (!$hive) {
                api_fail('La colmena no existe.', 404);
            }
            $notes = query_all('SELECT * FROM hive_notes WHERE hive_id=? ORDER BY note_date DESC, id DESC', [$id]);
            $photos = query_all('SELECT id, hive_id, original_name, mime_type, size_bytes, caption, uploaded_at, (id=?) AS is_cover FROM hive_photos WHERE hive_id=? ORDER BY uploaded_at DESC', [(int)($hive['cover_photo_id'] ?? 0), $id]);
            $queens = query_all('SELECT * FROM hive_queen_history WHERE hive_id=? ORDER BY change_date DESC, id DESC', [$id]);
            $materials = query_all('SELECT * FROM materials WHERE hive_id=? AND status="en_uso" ORDER BY name', [$id]);
            $activities = query_all(
                "SELECT a.*, s.name AS status_name, s.color AS status_color, s.is_closed, l.name AS label_name
                 FROM activities a JOIN activity_statuses s ON s.id=a.status_id LEFT JOIN activity_labels l ON l.id=a.label_id
                 WHERE a.hive_id=? ORDER BY s.is_closed, a.updated_at DESC",
                [$id]
            );
            api_ok(['hive' => $hive, 'notes' => $notes, 'photos' => $photos, 'queens' => $queens, 'materials' => $materials, 'activities' => $activities, 'technical' => apiary_hive_technical_summary($id)]);

        case 'hive_save':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $id = api_int($data, 'id');
            $name = api_string($data, 'name');
            $status = api_string($data, 'status', 'activa');
            $creationDate = api_string($data, 'creation_date', date('Y-m-d'));
            $queenYear = api_int($data, 'queen_year');
            if ($name === '') {
                api_fail('El nombre de la colmena es obligatorio.');
            }
            if (!in_array($status, ['activa', 'inactiva', 'observacion', 'baja'], true)) {
                $status = 'activa';
            }
            if ($id) {
                $existingHive = query_one('SELECT queen_year FROM hives WHERE id=?', [$id]);
                execute_sql('UPDATE hives SET name=?, status=?, creation_date=? WHERE id=?', [$name, $status, $creationDate, $id]);
                if ($queenYear !== null && (int)($existingHive['queen_year'] ?? 0) !== $queenYear) {
                    execute_sql('INSERT INTO hive_queen_history (hive_id, queen_year, change_date, notes) VALUES (?, ?, ?, ?)', [$id, $queenYear, date('Y-m-d'), 'Actualizada desde la edición de la colmena']);
                    execute_sql('UPDATE hives SET queen_year=? WHERE id=?', [$queenYear, $id]);
                }
            } else {
                execute_sql('INSERT INTO hives (name, status, creation_date, queen_year) VALUES (?, ?, ?, ?)', [$name, $status, $creationDate, $queenYear]);
                $id = (int)db()->lastInsertId();
                if ($queenYear !== null) {
                    execute_sql('INSERT INTO hive_queen_history (hive_id, queen_year, change_date, notes) VALUES (?, ?, ?, ?)', [$id, $queenYear, sprintf('%04d-01-01', $queenYear), 'Reina inicial']);
                }
            }
            api_ok(['id' => $id], 'Colmena guardada.');

        case 'hive_delete':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $id = api_int($data, 'id', 0) ?? 0;
            foreach (query_all('SELECT relative_path FROM hive_photos WHERE hive_id=?', [$id]) as $photo) {
                api_delete_file($photo['relative_path']);
            }
            execute_sql('DELETE FROM hives WHERE id=?', [$id]);
            api_ok([], 'Colmena eliminada.');

        case 'hive_note_save':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $hiveId = api_int($data, 'hive_id', 0) ?? 0;
            $note = api_string($data, 'note');
            $date = api_string($data, 'note_date', date('Y-m-d'));
            if ($note === '') {
                api_fail('Escriba una observación.');
            }
            execute_sql('INSERT INTO hive_notes (hive_id, note, note_date) VALUES (?, ?, ?)', [$hiveId, $note, $date]);
            api_ok([], 'Observación agregada.');

        case 'hive_note_delete':
            api_require_method('POST');
            api_user();
            $data = api_input();
            execute_sql('DELETE FROM hive_notes WHERE id=? AND hive_id=?', [api_int($data, 'id', 0), api_int($data, 'hive_id', 0)]);
            api_ok([], 'Observación eliminada.');

        case 'hive_photo_upload':
            api_require_method('POST');
            api_user();
            $hiveId = (int)($_POST['hive_id'] ?? 0);
            $file = api_upload('photo', 'hives');
            if (!$file) {
                api_fail('Seleccione una foto o PDF.');
            }
            $caption = trim((string)($_POST['caption'] ?? ''));
            execute_sql(
                'INSERT INTO hive_photos (hive_id, original_name, relative_path, mime_type, size_bytes, caption) VALUES (?, ?, ?, ?, ?, ?)',
                [$hiveId, $file['original_name'], $file['relative_path'], $file['mime_type'], $file['size_bytes'], $caption ?: null]
            );
            $photoId = (int)db()->lastInsertId();
            $currentCover = query_one('SELECT cover_photo_id FROM hives WHERE id=?', [$hiveId]);
            if (str_starts_with((string)$file['mime_type'], 'image/') && empty($currentCover['cover_photo_id'])) {
                execute_sql('UPDATE hives SET cover_photo_id=? WHERE id=?', [$photoId, $hiveId]);
            }
            api_ok(['id' => $photoId], 'Archivo agregado a la colmena.');

        case 'hive_photo_delete':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $id = api_int($data, 'id', 0) ?? 0;
            $hiveId = api_int($data, 'hive_id', 0) ?? 0;
            $photo = query_one('SELECT relative_path FROM hive_photos WHERE id=? AND hive_id=?', [$id, $hiveId]);
            if ($photo) {
                api_delete_file($photo['relative_path']);
                execute_sql('DELETE FROM hive_photos WHERE id=?', [$id]);
                $hiveRow = query_one('SELECT cover_photo_id FROM hives WHERE id=?', [$hiveId]);
                if ((int)($hiveRow['cover_photo_id'] ?? 0) === $id) {
                    $replacement = query_one("SELECT id FROM hive_photos WHERE hive_id=? AND mime_type LIKE 'image/%' ORDER BY uploaded_at DESC, id DESC LIMIT 1", [$hiveId]);
                    execute_sql('UPDATE hives SET cover_photo_id=? WHERE id=?', [$replacement ? (int)$replacement['id'] : null, $hiveId]);
                }
            }
            api_ok([], 'Archivo eliminado.');

        case 'hive_photo_cover':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $id = api_int($data, 'id', 0) ?? 0;
            $hiveId = api_int($data, 'hive_id', 0) ?? 0;
            $photo = query_one("SELECT id FROM hive_photos WHERE id=? AND hive_id=? AND mime_type LIKE 'image/%'", [$id, $hiveId]);
            if (!$photo) {
                api_fail('Seleccione una fotografía válida de esta colmena.');
            }
            execute_sql('UPDATE hives SET cover_photo_id=? WHERE id=?', [$id, $hiveId]);
            api_ok([], 'Banner de la colmena actualizado.');

        case 'hive_queen_save':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $hiveId = api_int($data, 'hive_id', 0) ?? 0;
            $queenYear = api_int($data, 'queen_year');
            $changeDate = api_string($data, 'change_date', date('Y-m-d'));
            $notes = api_string($data, 'notes');
            $maxYear = (int)date('Y') + 1;
            if (!$hiveId || $queenYear === null || $queenYear < 1990 || $queenYear > $maxYear) {
                api_fail('Indique un año de reina válido.');
            }
            if (!query_one('SELECT id FROM hives WHERE id=?', [$hiveId])) {
                api_fail('La colmena no existe.', 404);
            }
            execute_sql('INSERT INTO hive_queen_history (hive_id, queen_year, change_date, notes) VALUES (?, ?, ?, ?)', [$hiveId, $queenYear, $changeDate, $notes ?: null]);
            $current = query_one('SELECT queen_year FROM hive_queen_history WHERE hive_id=? ORDER BY change_date DESC, id DESC LIMIT 1', [$hiveId]);
            execute_sql('UPDATE hives SET queen_year=? WHERE id=?', [(int)$current['queen_year'], $hiveId]);
            api_ok([], 'Nueva reina agregada al historial.');

        case 'hive_queen_delete':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $id = api_int($data, 'id', 0) ?? 0;
            $hiveId = api_int($data, 'hive_id', 0) ?? 0;
            execute_sql('DELETE FROM hive_queen_history WHERE id=? AND hive_id=?', [$id, $hiveId]);
            $current = query_one('SELECT queen_year FROM hive_queen_history WHERE hive_id=? ORDER BY change_date DESC, id DESC LIMIT 1', [$hiveId]);
            execute_sql('UPDATE hives SET queen_year=? WHERE id=?', [$current ? (int)$current['queen_year'] : null, $hiveId]);
            api_ok([], 'Registro de reina eliminado.');

        case 'apiculture_banner_upload':
            api_require_method('POST');
            api_user();
            $file = api_upload('banner', 'apiculture');
            if (!$file || !str_starts_with((string)$file['mime_type'], 'image/')) {
                if ($file) api_delete_file($file['relative_path']);
                api_fail('Seleccione una imagen JPG, PNG o WEBP.');
            }
            $old = query_one('SELECT relative_path FROM apiculture_banner WHERE id=1');
            if ($old && !empty($old['relative_path'])) api_delete_file($old['relative_path']);
            $caption = trim((string)($_POST['caption'] ?? ''));
            execute_sql('UPDATE apiculture_banner SET original_name=?, relative_path=?, mime_type=?, caption=? WHERE id=1', [$file['original_name'], $file['relative_path'], $file['mime_type'], $caption ?: 'Vista general del apiario']);
            api_ok([], 'Banner del inicio actualizado.');

        case 'apiculture_banner_delete':
            api_require_method('POST');
            api_user();
            $old = query_one('SELECT relative_path FROM apiculture_banner WHERE id=1');
            if ($old && !empty($old['relative_path'])) api_delete_file($old['relative_path']);
            execute_sql('UPDATE apiculture_banner SET original_name=NULL, relative_path=NULL, mime_type=NULL WHERE id=1');
            api_ok([], 'Banner eliminado.');

        case 'materials':
            api_user();
            $status=trim((string)($_GET['status']??''));$category=trim((string)($_GET['category']??''));$search=trim((string)($_GET['q']??''));$where=[];$params=[];
            if(in_array($status,['disponible','en_uso','reparacion'],true)){$where[]='m.status=?';$params[]=$status;}
            if($category!==''){$where[]='m.category=?';$params[]=$category;}
            if($search!==''){$where[]='(m.name LIKE ? OR m.category LIKE ? OR m.notes LIKE ? OR h.name LIKE ?)';array_push($params,"%{$search}%","%{$search}%","%{$search}%","%{$search}%");}
            $wh=$where?'WHERE '.implode(' AND ',$where):'';
            $materials=query_all("SELECT m.*,h.name hive_name FROM materials m LEFT JOIN hives h ON h.id=m.hive_id {$wh} ORDER BY m.category,FIELD(m.status,'en_uso','disponible','reparacion'),m.name",$params);
            $counts=query_one("SELECT COUNT(*) total,COALESCE(SUM(status='disponible'),0) available,COALESCE(SUM(status='en_uso'),0) in_use,COALESCE(SUM(status='reparacion'),0) repair FROM materials");
            $categories=query_all("SELECT c.id,c.name category,c.sort_order,COUNT(m.id) total,COALESCE(SUM(m.status='disponible'),0) available,COALESCE(SUM(m.status='en_uso'),0) in_use,COALESCE(SUM(m.status='reparacion'),0) repair FROM material_categories c LEFT JOIN materials m ON m.category=c.name GROUP BY c.id,c.name,c.sort_order ORDER BY c.sort_order,c.name");
            $hives=query_all("SELECT id,name FROM hives WHERE status<>'baja' ORDER BY name");
            api_ok(['materials'=>$materials,'counts'=>$counts,'categories'=>$categories,'hives'=>$hives]);

        case 'material_save':
            api_require_method('POST');api_user();$d=api_input();$id=api_int($d,'id');$name=api_string($d,'name');$category=api_string($d,'category','Otros materiales');$status=api_string($d,'status','disponible');$hive=api_int($d,'hive_id');$notes=api_string($d,'notes');
            if($name==='')api_fail('El nombre del material es obligatorio.');if($category==='')$category='Otros materiales';if(mb_strlen($category)>100)api_fail('La categoría es demasiado larga.');if(!in_array($status,['disponible','en_uso','reparacion'],true))$status='disponible';if($status!=='en_uso')$hive=null;elseif(!$hive)api_fail('Indique en qué colmena está el material en uso.');
            $old=$id?query_one('SELECT photo_original_name,photo_relative_path,photo_mime_type FROM materials WHERE id=?',[$id]):null;if($id&&!$old)api_fail('El material no existe.',404);
            $photo=null;if(isset($_FILES['photo'])&&($_FILES['photo']['error']??UPLOAD_ERR_NO_FILE)!==UPLOAD_ERR_NO_FILE){$photo=api_upload('photo','materials');if(!$photo||!str_starts_with((string)$photo['mime_type'],'image/')){if($photo)api_delete_file($photo['relative_path']);api_fail('La foto debe ser JPG, PNG o WEBP.');}}
            $remove=!empty($d['remove_photo']);$po=$photo['original_name']??($remove?null:($old['photo_original_name']??null));$pr=$photo['relative_path']??($remove?null:($old['photo_relative_path']??null));$pm=$photo['mime_type']??($remove?null:($old['photo_mime_type']??null));if(($photo||$remove)&&$old&&!empty($old['photo_relative_path']))api_delete_file($old['photo_relative_path']);
            execute_sql('INSERT IGNORE INTO material_categories (name) VALUES (?)',[$category]);
            if($id)execute_sql('UPDATE materials SET name=?,category=?,photo_original_name=?,photo_relative_path=?,photo_mime_type=?,status=?,hive_id=?,notes=? WHERE id=?',[$name,$category,$po,$pr,$pm,$status,$hive,$notes?:null,$id]);else{execute_sql('INSERT INTO materials (name,category,photo_original_name,photo_relative_path,photo_mime_type,status,hive_id,notes) VALUES (?,?,?,?,?,?,?,?)',[$name,$category,$po,$pr,$pm,$status,$hive,$notes?:null]);$id=(int)db()->lastInsertId();}
            api_ok(['id'=>$id],'Material guardado.');

        case 'material_category_save':
            api_require_method('POST');api_user();$d=api_input();$id=api_int($d,'id');$name=api_string($d,'name');if(!$name)api_fail('Indique el nombre de la categoría.');if(mb_strlen($name)>100)api_fail('La categoría es demasiado larga.');
            if($id){$old=query_one('SELECT name FROM material_categories WHERE id=?',[$id]);if(!$old)api_fail('La categoría no existe.',404);$dup=query_one('SELECT id FROM material_categories WHERE LOWER(name)=LOWER(?) AND id<>?',[$name,$id]);if($dup)api_fail('Ya existe una categoría con ese nombre.');$pdo=db();$pdo->beginTransaction();try{execute_sql('UPDATE material_categories SET name=? WHERE id=?',[$name,$id]);execute_sql('UPDATE materials SET category=? WHERE category=?',[$name,$old['name']]);$pdo->commit();}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}}else execute_sql('INSERT INTO material_categories (name) VALUES (?)',[$name]);api_ok([],'Categoría guardada.');

        case 'material_category_delete':
            api_require_method('POST');api_user();$id=api_int(api_input(),'id',0)??0;$row=query_one('SELECT name FROM material_categories WHERE id=?',[$id]);if(!$row)api_fail('La categoría no existe.',404);if(strcasecmp((string)$row['name'],'Otros materiales')===0)api_fail('La categoría Otros materiales no puede eliminarse.');$count=(int)(query_one('SELECT COUNT(*) total FROM materials WHERE category=?',[$row['name']])['total']??0);if($count>0)api_fail('Mueva o elimine los materiales de esta categoría antes de borrarla.');execute_sql('DELETE FROM material_categories WHERE id=?',[$id]);api_ok([],'Categoría eliminada.');

        case 'material_delete':
            api_require_method('POST');api_user();$id=api_int(api_input(),'id',0)??0;$row=query_one('SELECT photo_relative_path FROM materials WHERE id=?',[$id]);if($row)api_delete_file($row['photo_relative_path']);execute_sql('DELETE FROM materials WHERE id=?',[$id]);api_ok([],'Material eliminado.');

        case 'activity_options':
            api_user();
            ensure_apiculture_activity_labels();
            api_ok([
                'statuses' => query_all("SELECT * FROM activity_statuses WHERE slug<>'compras' ORDER BY sort_order, id"),
                'labels' => query_all('SELECT * FROM activity_labels ORDER BY name'),
                'hives' => query_all("SELECT id, name FROM hives WHERE status<>'baja' ORDER BY name"),
            ]);

        case 'activities':
            api_user();
            ensure_apiculture_activity_labels();
            $hiveId = filter_input(INPUT_GET, 'hive_id', FILTER_VALIDATE_INT) ?: 0;
            $labelId = filter_input(INPUT_GET, 'label_id', FILTER_VALIDATE_INT) ?: 0;
            $search = trim((string)($_GET['q'] ?? ''));
            $where = ["s.slug<>'compras'"];
            $params = [];
            if ($hiveId) { $where[] = 'a.hive_id=?'; $params[] = $hiveId; }
            if ($labelId) { $where[] = 'a.label_id=?'; $params[] = $labelId; }
            if ($search !== '') { $where[] = '(a.title LIKE ? OR a.description LIKE ? OR h.name LIKE ?)'; array_push($params, "%{$search}%", "%{$search}%", "%{$search}%"); }
            $sqlWhere = 'WHERE ' . implode(' AND ', $where);
            $activities = query_all(
                "SELECT a.*, h.name AS hive_name, s.name AS status_name, s.slug AS status_slug, s.color AS status_color,
                        l.name AS label_name, l.color AS label_color,
                        (SELECT aa.id FROM activity_attachments aa WHERE aa.activity_id=a.id AND aa.mime_type LIKE 'image/%' ORDER BY aa.uploaded_at DESC,aa.id DESC LIMIT 1) AS preview_image_id
                 FROM activities a JOIN activity_statuses s ON s.id=a.status_id
                 LEFT JOIN activity_labels l ON l.id=a.label_id LEFT JOIN hives h ON h.id=a.hive_id
                 {$sqlWhere} ORDER BY s.sort_order, a.position, a.due_date IS NULL, a.due_date, a.id",
                $params
            );
            $purchasePlans = [];
            if (!$hiveId && !$labelId) {
                $purchaseWhere = "WHERE p.status='pendiente'";
                $purchaseParams = [];
                if ($search !== '') {
                    $purchaseWhere .= ' AND (p.title LIKE ? OR p.notes LIKE ?)';
                    $purchaseParams = ["%{$search}%", "%{$search}%"];
                }
                $purchasePlans = query_all(
                    "SELECT p.id, p.title, p.plan_month, p.notes, COUNT(i.id) AS item_count,
                            COALESCE(SUM(i.quantity*i.unit_price),0) AS total_amount
                     FROM purchase_plans p LEFT JOIN purchase_items i ON i.plan_id=p.id
                     {$purchaseWhere} GROUP BY p.id ORDER BY p.plan_month, p.id",
                    $purchaseParams
                );
            }
            api_ok([
                'statuses' => query_all("SELECT * FROM activity_statuses WHERE slug<>'compras' ORDER BY sort_order, id"),
                'activities' => $activities,
                'purchase_plans' => $purchasePlans,
                'hives' => query_all('SELECT id, name FROM hives ORDER BY name'),
                'labels' => query_all('SELECT id, name FROM activity_labels ORDER BY name'),
            ]);

        case 'activity':
            api_user();
            ensure_apiculture_activity_labels();
            $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT) ?: 0;
            $activity = $id ? query_one("SELECT a.*,h.name hive_name,s.name status_name,s.slug status_slug,s.color status_color,l.name label_name,l.color label_color FROM activities a JOIN activity_statuses s ON s.id=a.status_id LEFT JOIN hives h ON h.id=a.hive_id LEFT JOIN activity_labels l ON l.id=a.label_id WHERE a.id=?", [$id]) : null;
            if ($id && !$activity) {
                api_fail('La actividad no existe.', 404);
            }
            api_ok([
                'activity' => $activity,
                'statuses' => query_all("SELECT * FROM activity_statuses WHERE slug<>'compras' ORDER BY sort_order, id"),
                'labels' => query_all('SELECT * FROM activity_labels ORDER BY name'),
                'hives' => query_all("SELECT id, name FROM hives WHERE status<>'baja' ORDER BY name"),
                'attachments' => $id ? query_all('SELECT id, original_name, mime_type, size_bytes, uploaded_at FROM activity_attachments WHERE activity_id=? ORDER BY uploaded_at DESC', [$id]) : [],
                'logs' => $id ? query_all('SELECT * FROM activity_logs WHERE activity_id=? ORDER BY created_at DESC, id DESC', [$id]) : [],
            ]);

        case 'activity_save':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $id = api_int($data, 'id');
            $title = api_string($data, 'title');
            $description = api_string($data, 'description');
            $hiveId = api_int($data, 'hive_id');
            $responsible = api_string($data, 'responsible');
            $statusId = api_int($data, 'status_id', 1) ?? 1;
            $labelId = api_int($data, 'label_id');
            $priority = api_string($data, 'priority', 'normal');
            $dueDate = api_string($data, 'due_date') ?: null;
            if ($title === '') {
                api_fail('El título de la actividad es obligatorio.');
            }
            if (!in_array($priority, ['baja', 'normal', 'alta', 'urgente'], true)) {
                $priority = 'normal';
            }
            $closed = query_one('SELECT is_closed FROM activity_statuses WHERE id=?', [$statusId]);
            $completedAt = !empty($closed['is_closed']) ? date('Y-m-d H:i:s') : null;
            if ($id) {
                $old = query_one('SELECT status_id FROM activities WHERE id=?', [$id]);
                execute_sql(
                    'UPDATE activities SET title=?, description=?, hive_id=?, responsible=?, status_id=?, label_id=?, priority=?, due_date=?, completed_at=? WHERE id=?',
                    [$title, $description ?: null, $hiveId, $responsible ?: null, $statusId, $labelId, $priority, $dueDate, $completedAt, $id]
                );
                execute_sql('INSERT INTO activity_logs (activity_id, action, details) VALUES (?, ?, ?)', [$id, 'Actividad editada', $old && (int)$old['status_id'] !== $statusId ? 'También cambió de estado.' : null]);
            } else {
                $position = (int)(query_one('SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM activities WHERE status_id=?', [$statusId])['next_position'] ?? 1);
                execute_sql(
                    'INSERT INTO activities (title, description, hive_id, responsible, status_id, label_id, priority, due_date, position, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$title, $description ?: null, $hiveId, $responsible ?: null, $statusId, $labelId, $priority, $dueDate, $position, $completedAt]
                );
                $id = (int)db()->lastInsertId();
                execute_sql('INSERT INTO activity_logs (activity_id, action) VALUES (?, ?)', [$id, 'Actividad creada']);
            }
            if (isset($_FILES['attachment']) && $_FILES['attachment']['error'] !== UPLOAD_ERR_NO_FILE) {
                $file = api_upload('attachment', 'activities');
                if ($file) {
                    execute_sql('INSERT INTO activity_attachments (activity_id, original_name, relative_path, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)', [$id, $file['original_name'], $file['relative_path'], $file['mime_type'], $file['size_bytes']]);
                }
            }
            google_calendar_sync_app_best_effort('apicultura');
            api_ok(['id' => $id], 'Actividad guardada.');

        case 'activity_delete':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $id = api_int($data, 'id', 0) ?? 0;
            foreach (query_all('SELECT relative_path FROM activity_attachments WHERE activity_id=?', [$id]) as $file) {
                api_delete_file($file['relative_path']);
            }
            execute_sql('DELETE FROM activities WHERE id=?', [$id]);
            google_calendar_sync_app_best_effort('apicultura');
            api_ok([], 'Actividad eliminada.');

        case 'activity_attachment_upload':
            api_require_method('POST');
            api_user();
            $activityId = (int)($_POST['activity_id'] ?? 0);
            $file = api_upload('attachment', 'activities');
            if (!$file) {
                api_fail('Seleccione un archivo.');
            }
            execute_sql('INSERT INTO activity_attachments (activity_id, original_name, relative_path, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)', [$activityId, $file['original_name'], $file['relative_path'], $file['mime_type'], $file['size_bytes']]);
            execute_sql('INSERT INTO activity_logs (activity_id, action) VALUES (?, ?)', [$activityId, 'Archivo agregado']);
            api_ok([], 'Archivo agregado.');

        case 'activity_attachment_delete':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $id = api_int($data, 'id', 0) ?? 0;
            $activityId = api_int($data, 'activity_id', 0) ?? 0;
            $file = query_one('SELECT relative_path FROM activity_attachments WHERE id=? AND activity_id=?', [$id, $activityId]);
            if ($file) {
                api_delete_file($file['relative_path']);
                execute_sql('DELETE FROM activity_attachments WHERE id=?', [$id]);
            }
            api_ok([], 'Archivo eliminado.');

        case 'activity_status_update':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $activityId = api_int($data, 'activity_id', 0) ?? 0;
            $statusId = api_int($data, 'status_id', 0) ?? 0;
            $orderedIds = $data['ordered_ids'] ?? [];
            $closed = query_one('SELECT is_closed FROM activity_statuses WHERE id=?', [$statusId]);
            if (!$closed) {
                api_fail('Estado inválido.');
            }
            $completedAt = !empty($closed['is_closed']) ? date('Y-m-d H:i:s') : null;
            db()->beginTransaction();
            execute_sql('UPDATE activities SET status_id=?, completed_at=? WHERE id=?', [$statusId, $completedAt, $activityId]);
            if (is_array($orderedIds)) {
                foreach (array_values($orderedIds) as $position => $orderedId) {
                    execute_sql('UPDATE activities SET position=? WHERE id=? AND status_id=?', [$position + 1, (int)$orderedId, $statusId]);
                }
            }
            execute_sql('INSERT INTO activity_logs (activity_id, action) VALUES (?, ?)', [$activityId, 'Estado actualizado desde el tablero']);
            db()->commit();
            google_calendar_sync_app_best_effort('apicultura');
            api_ok([], 'Estado actualizado.');

        case 'purchases':
            api_user();
            $year = filter_input(INPUT_GET, 'year', FILTER_VALIDATE_INT) ?: 0;
            $where = $year ? 'WHERE YEAR(p.plan_month)=?' : '';
            $params = $year ? [$year] : [];
            $plans = query_all(
                "SELECT p.*, COUNT(i.id) AS item_count,
                        COALESCE(SUM(i.quantity*i.unit_price),0) AS total_amount,
                        COALESCE(SUM(CASE WHEN i.is_purchased=0 THEN i.quantity*i.unit_price ELSE 0 END),0) AS pending_amount,
                        COALESCE(SUM(i.is_purchased=0),0) AS pending_count
                 FROM purchase_plans p LEFT JOIN purchase_items i ON i.plan_id=p.id {$where}
                 GROUP BY p.id ORDER BY p.status='pendiente' DESC, p.plan_month DESC, p.id DESC",
                $params
            );
            $years = query_all('SELECT DISTINCT YEAR(plan_month) AS year FROM purchase_plans ORDER BY year DESC');
            api_ok(['plans' => $plans, 'years' => $years]);

        case 'purchase':
            api_user();
            $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT) ?: 0;
            $plan = query_one('SELECT * FROM purchase_plans WHERE id=?', [$id]);
            if (!$plan) {
                api_fail('La compra pendiente no existe.', 404);
            }
            $items = query_all('SELECT *, quantity*unit_price AS line_total FROM purchase_items WHERE plan_id=? ORDER BY is_purchased, id', [$id]);
            api_ok(['plan' => $plan, 'items' => $items]);

        case 'purchase_plan_save':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $id = api_int($data, 'id');
            $title = api_string($data, 'title');
            $month = api_string($data, 'plan_month', date('Y-m'));
            $month = substr($month, 0, 7) . '-01';
            $notes = api_string($data, 'notes');
            if ($title === '') {
                $title = 'Compra pendiente de ' . month_label($month);
            }
            if ($id) {
                $existingPlan = query_one('SELECT status FROM purchase_plans WHERE id=?', [$id]);
                if (($existingPlan['status'] ?? 'pendiente') === 'realizada') {
                    api_fail('La compra está cerrada y no puede modificarse.');
                }
                execute_sql('UPDATE purchase_plans SET title=?, plan_month=?, notes=? WHERE id=?', [$title, $month, $notes ?: null, $id]);
            } else {
                execute_sql('INSERT INTO purchase_plans (title, plan_month, notes) VALUES (?, ?, ?)', [$title, $month, $notes ?: null]);
                $id = (int)db()->lastInsertId();
            }
            api_ok(['id' => $id], 'Compra pendiente guardada.');

        case 'purchase_plan_delete':
            api_require_method('POST');
            api_user();
            $data = api_input();
            execute_sql('DELETE FROM purchase_plans WHERE id=?', [api_int($data, 'id', 0)]);
            api_ok([], 'Tarjeta de compra eliminada.');

        case 'purchase_complete':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $result = complete_purchase_plan(api_int($data, 'id', 0) ?? 0);
            api_ok($result, 'Compra realizada. Los materiales quedaron disponibles.');

        case 'purchase_item_save':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $id = api_int($data, 'id');
            $planId = api_int($data, 'plan_id', 0) ?? 0;
            $planState = query_one('SELECT status FROM purchase_plans WHERE id=?', [$planId]);
            if (($planState['status'] ?? 'pendiente') === 'realizada') {
                api_fail('La compra está cerrada y no puede modificarse.');
            }
            $name = api_string($data, 'item_name');
            $quantity = max(1, (int)round(api_decimal($data, 'quantity', 1)));
            $unitPrice = api_decimal($data, 'unit_price', 0);
            $place = api_string($data, 'purchase_place');
            $purchased = !empty($data['is_purchased']) ? 1 : 0;
            $notes = api_string($data, 'notes');
            if ($name === '') {
                api_fail('El elemento es obligatorio.');
            }
            if ($id) {
                execute_sql('UPDATE purchase_items SET item_name=?, quantity=?, unit_price=?, purchase_place=?, is_purchased=?, notes=? WHERE id=? AND plan_id=?', [$name, $quantity, $unitPrice, $place ?: null, $purchased, $notes ?: null, $id, $planId]);
            } else {
                execute_sql('INSERT INTO purchase_items (plan_id, item_name, quantity, unit_price, purchase_place, is_purchased, notes) VALUES (?, ?, ?, ?, ?, ?, ?)', [$planId, $name, $quantity, $unitPrice, $place ?: null, $purchased, $notes ?: null]);
                $id = (int)db()->lastInsertId();
            }
            api_ok(['id' => $id], 'Renglón guardado.');

        case 'purchase_item_delete':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $planId = api_int($data, 'plan_id', 0) ?? 0;
            $planState = query_one('SELECT status FROM purchase_plans WHERE id=?', [$planId]);
            if (($planState['status'] ?? 'pendiente') === 'realizada') {
                api_fail('La compra está cerrada y no puede modificarse.');
            }
            execute_sql('DELETE FROM purchase_items WHERE id=? AND plan_id=?', [api_int($data, 'id', 0), $planId]);
            api_ok([], 'Renglón eliminado.');

        case 'accounting':
            api_user();
            $filters = [
                'date_from' => trim((string)($_GET['date_from'] ?? '')),
                'date_to' => trim((string)($_GET['date_to'] ?? '')),
                'person_id' => filter_input(INPUT_GET, 'person_id', FILTER_VALIDATE_INT) ?: 0,
                'movement_type' => trim((string)($_GET['movement_type'] ?? '')),
                'concept_id' => filter_input(INPUT_GET, 'concept_id', FILTER_VALIDATE_INT) ?: 0,
                'q' => trim((string)($_GET['q'] ?? '')),
            ];
            $where = [];
            $params = [];
            if ($filters['date_from'] !== '') { $where[] = 'e.entry_date>=?'; $params[] = $filters['date_from']; }
            if ($filters['date_to'] !== '') { $where[] = 'e.entry_date<=?'; $params[] = $filters['date_to']; }
            if ($filters['person_id']) { $where[] = 'e.person_id=?'; $params[] = $filters['person_id']; }
            if (in_array($filters['movement_type'], ['ingreso', 'egreso'], true)) { $where[] = 'e.movement_type=?'; $params[] = $filters['movement_type']; }
            if ($filters['concept_id']) { $where[] = 'e.concept_id=?'; $params[] = $filters['concept_id']; }
            if ($filters['q'] !== '') { $where[] = 'e.description LIKE ?'; $params[] = '%' . $filters['q'] . '%'; }
            $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
            $entries = query_all(
                "SELECT e.*, p.name AS person_name, c.name AS concept_name, c.default_type
                 FROM accounting_entries e JOIN accounting_people p ON p.id=e.person_id JOIN accounting_concepts c ON c.id=e.concept_id
                 {$sqlWhere} ORDER BY e.entry_date DESC, e.id DESC",
                $params
            );
            $summary = query_one(
                "SELECT COALESCE(SUM(CASE WHEN e.movement_type='ingreso' THEN e.amount_ars ELSE 0 END),0) AS income_ars,
                        COALESCE(SUM(CASE WHEN e.movement_type='egreso' THEN e.amount_ars ELSE 0 END),0) AS expense_ars,
                        COALESCE(SUM(CASE WHEN e.movement_type='ingreso' THEN e.amount_usd ELSE 0 END),0) AS income_usd,
                        COALESCE(SUM(CASE WHEN e.movement_type='egreso' THEN e.amount_usd ELSE 0 END),0) AS expense_usd,
                        COUNT(*) AS total
                 FROM accounting_entries e JOIN accounting_people p ON p.id=e.person_id JOIN accounting_concepts c ON c.id=e.concept_id {$sqlWhere}",
                $params
            );
            $balanceByPerson = query_all(
                "SELECT p.id, p.name,
                        COALESCE(SUM(CASE WHEN e.movement_type='ingreso' THEN e.amount_ars ELSE -e.amount_ars END),0) balance_ars,
                        COALESCE(SUM(CASE WHEN e.movement_type='ingreso' THEN e.amount_usd ELSE -e.amount_usd END),0) balance_usd
                 FROM accounting_people p LEFT JOIN accounting_entries e ON e.person_id=p.id
                 WHERE p.active=1 AND LOWER(p.name) IN ('chiara','felipe') GROUP BY p.id,p.name ORDER BY p.id"
            );
            api_ok([
                'filters' => $filters,
                'entries' => $entries,
                'summary' => $summary,
                'balances' => $balanceByPerson,
                'people' => query_all("SELECT * FROM accounting_people WHERE active=1 AND LOWER(name) IN ('chiara','felipe') ORDER BY id"),
                'concepts' => query_all('SELECT * FROM accounting_concepts WHERE active=1 ORDER BY name'),
            ]);

        case 'accounting_save':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $id = api_int($data, 'id');
            $date = api_string($data, 'entry_date', date('Y-m-d'));
            $personId = api_int($data, 'person_id', 0) ?? 0;
            $type = api_string($data, 'movement_type', 'egreso');
            $conceptId = api_int($data, 'concept_id', 0) ?? 0;
            $amountArs = api_decimal($data, 'amount_ars');
            $usdRate = api_decimal($data, 'usd_rate');
            $description = api_string($data, 'description');
            if (!in_array($type, ['ingreso', 'egreso'], true)) {
                $type = 'egreso';
            }
            if (!$id && $type === 'ingreso') {
                if ($amountArs <= 0 || $usdRate <= 0 || !$conceptId) api_fail('Complete concepto, importe y cotización con valores válidos.');
                $allocation=apiculture_income_allocation($amountArs);
                $file=api_upload('receipt','receipts');
                $pdo=db();$pdo->beginTransaction();$ids=[];
                try {
                    $parts=[];foreach($allocation as $row){if((float)$row['amount']<=0)continue;$parts[]=$row;}
                    foreach($parts as $i=>$row){
                        $share=(float)$row['amount'];$pct=round((float)$row['percent'],2);
                        $base='Apiario La Ruda · reparto automático '.number_format($pct,2,',','.').'% para '.$row['name'];
                        $desc=$description!==''?$base.' · '.$description:$base;
                        $hasReceipt=$i===0&&$file;
                        execute_sql('INSERT INTO accounting_entries (entry_date,person_id,movement_type,concept_id,amount_ars,usd_rate,amount_usd,description,receipt_original_name,receipt_relative_path,receipt_mime_type) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[$date,(int)$row['person_id'],'ingreso',$conceptId,$share,$usdRate,$share/$usdRate,$desc,$hasReceipt?$file['original_name']:null,$hasReceipt?$file['relative_path']:null,$hasReceipt?$file['mime_type']:null]);
                        $ids[]=(int)$pdo->lastInsertId();
                    }
                    $pdo->commit();
                } catch(Throwable $e) { if($pdo->inTransaction())$pdo->rollBack(); if($file)api_delete_file($file['relative_path']); throw $e; }
                api_ok(['ids'=>$ids,'allocation'=>$allocation],'Ingreso de Apiario La Ruda repartido automáticamente.');
            }
            if ($amountArs <= 0 || $usdRate <= 0 || !$personId || !$conceptId) {
                api_fail('Complete persona, concepto, importe y cotización con valores válidos.');
            }
            $amountUsd = $amountArs / $usdRate;
            $old = $id ? query_one('SELECT receipt_relative_path, receipt_original_name, receipt_mime_type FROM accounting_entries WHERE id=?', [$id]) : null;
            $file = api_upload('receipt', 'receipts');
            $path = $file['relative_path'] ?? ($old['receipt_relative_path'] ?? null);
            $name = $file['original_name'] ?? ($old['receipt_original_name'] ?? null);
            $mime = $file['mime_type'] ?? ($old['receipt_mime_type'] ?? null);
            if ($file && !empty($old['receipt_relative_path'])) {
                api_delete_file($old['receipt_relative_path']);
            }
            if ($id) {
                execute_sql('UPDATE accounting_entries SET entry_date=?, person_id=?, movement_type=?, concept_id=?, amount_ars=?, usd_rate=?, amount_usd=?, description=?, receipt_original_name=?, receipt_relative_path=?, receipt_mime_type=? WHERE id=?', [$date, $personId, $type, $conceptId, $amountArs, $usdRate, $amountUsd, $description ?: null, $name, $path, $mime, $id]);
            } else {
                execute_sql('INSERT INTO accounting_entries (entry_date, person_id, movement_type, concept_id, amount_ars, usd_rate, amount_usd, description, receipt_original_name, receipt_relative_path, receipt_mime_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [$date, $personId, $type, $conceptId, $amountArs, $usdRate, $amountUsd, $description ?: null, $name, $path, $mime]);
                $id = (int)db()->lastInsertId();
            }
            api_ok(['id' => $id], 'Movimiento guardado.');

        case 'accounting_delete':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $id = api_int($data, 'id', 0) ?? 0;
            $row = query_one('SELECT receipt_relative_path FROM accounting_entries WHERE id=?', [$id]);
            if ($row) {
                api_delete_file($row['receipt_relative_path']);
                execute_sql('DELETE FROM accounting_entries WHERE id=?', [$id]);
            }
            api_ok([], 'Movimiento eliminado.');

        case 'backups':
            api_user();
            api_ok(['backups' => query_all('SELECT * FROM backup_history ORDER BY created_at DESC')]);

        case 'backup_create':
            api_require_method('POST');
            api_user();
            require_once dirname(__DIR__) . '/backup_lib.php';
            $path = create_backup_archive('completa');
            api_send_file($path, basename($path), 'application/zip', false);

        case 'backup_restore':
            api_require_method('POST');
            api_user();
            if (!isset($_FILES['backup_zip']) || $_FILES['backup_zip']['error'] !== UPLOAD_ERR_OK) {
                api_fail('Seleccione un archivo ZIP válido.');
            }
            if ((int)$_FILES['backup_zip']['size'] > 500 * 1024 * 1024) {
                api_fail('La copia supera el límite de 500 MB.');
            }
            require_once dirname(__DIR__) . '/backup_lib.php';
            restore_backup_archive($_FILES['backup_zip']['tmp_name']);
            execute_sql('DELETE FROM api_tokens');
            api_ok([], 'La copia se restauró correctamente. Vuelva a ingresar.');

        case 'backup_delete':
            api_require_method('POST');
            api_user();
            $data = api_input();
            $id = api_int($data, 'id', 0) ?? 0;
            $row = query_one('SELECT filename FROM backup_history WHERE id=?', [$id]);
            if ($row) {
                $path = dirname(__DIR__) . '/storage/backups/' . basename((string)$row['filename']);
                if (is_file($path)) {
                    @unlink($path);
                }
                execute_sql('DELETE FROM backup_history WHERE id=?', [$id]);
            }
            api_ok([], 'Copia eliminada del disco.');

        case 'file':
            api_user();
            $type = trim((string)($_GET['type'] ?? ''));
            $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT) ?: 0;
            $row = null;
            $inline = true;
            if ($type === 'hive') {
                $row = query_one('SELECT original_name, relative_path, mime_type FROM hive_photos WHERE id=?', [$id]);
            } elseif ($type === 'apiculture_banner') {
                $row = query_one('SELECT original_name, relative_path, mime_type FROM apiculture_banner WHERE id=1');
            } elseif ($type === 'activity') {
                $row = query_one('SELECT original_name, relative_path, mime_type FROM activity_attachments WHERE id=?', [$id]);
            } elseif ($type === 'receipt') {
                $row = query_one('SELECT receipt_original_name AS original_name, receipt_relative_path AS relative_path, receipt_mime_type AS mime_type FROM accounting_entries WHERE id=?', [$id]);
            } elseif ($type === 'material') {
                $row = query_one('SELECT photo_original_name AS original_name,photo_relative_path AS relative_path,photo_mime_type AS mime_type FROM materials WHERE id=?',[$id]);
            } elseif ($type === 'apiary_inspection') {
                $row = query_one('SELECT original_name,relative_path,mime_type FROM hive_inspection_files WHERE id=?',[$id]);
            } elseif ($type === 'la_ruda_product') {
                ensure_la_ruda_schema();
                $row = query_one('SELECT photo_original_name AS original_name, photo_relative_path AS relative_path, photo_mime_type AS mime_type FROM la_ruda_products WHERE id=?', [$id]);
            } elseif ($type === 'la_ruda_3d_model') {
                api_require_app('apicultura');
                ensure_la_ruda_schema();
                $row = query_one('SELECT original_name,relative_path,mime_type FROM la_ruda_3d_models WHERE id=?',[$id]);
                $inline = false;
            } elseif ($type === 'backup') {
                $row = query_one("SELECT filename AS original_name, CONCAT('storage/backups/', filename) AS relative_path, 'application/zip' AS mime_type FROM backup_history WHERE id=?", [$id]);
                $inline = false;
            }
            if (!$row || empty($row['relative_path'])) {
                api_fail('El archivo no existe.', 404);
            }
            $relative = str_replace('\\', '/', (string)$row['relative_path']);
            if (str_contains($relative, '../') || !str_starts_with($relative, 'storage/')) {
                api_fail('Ruta de archivo inválida.', 400);
            }
            $absolute = dirname(__DIR__) . '/' . $relative;
            api_send_file($absolute, (string)($row['original_name'] ?: basename($absolute)), (string)($row['mime_type'] ?: 'application/octet-stream'), $inline);

        default:
            api_fail('Acción de API desconocida.', 404);
    }
} catch (PDOException $e) {
    if (db()->inTransaction()) {
        db()->rollBack();
    }
    if ((string)$e->getCode() === '23000') {
        api_fail('No se pudo guardar porque existe un nombre repetido o un registro relacionado.', 409);
    }
    api_fail(app_config()['debug'] ? 'Error de base de datos: ' . $e->getMessage() : 'Ocurrió un error de base de datos.', 500);
} catch (Throwable $e) {
    if (db()->inTransaction()) {
        db()->rollBack();
    }
    api_fail(app_config()['debug'] ? $e->getMessage() : 'Ocurrió un error inesperado.', 500);
}
