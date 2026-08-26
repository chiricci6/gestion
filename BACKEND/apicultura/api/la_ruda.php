<?php
declare(strict_types=1);

function la_ruda_user(): array
{
    return api_require_app('apicultura');
}

function la_ruda_upload_3d_model(string $field = 'model_file'): ?array
{
    if (!isset($_FILES[$field]) || (int)($_FILES[$field]['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) return null;
    $file = $_FILES[$field];
    if ((int)$file['error'] !== UPLOAD_ERR_OK) throw new RuntimeException('No se pudo cargar el modelo 3D. Código: ' . (int)$file['error']);
    $maxBytes = (int)(app_config()['uploads']['max_bytes'] ?? (10 * 1024 * 1024));
    if ((int)$file['size'] <= 0 || (int)$file['size'] > $maxBytes) throw new RuntimeException('El modelo 3D supera el límite de carga configurado en el servidor.');
    $original = basename((string)$file['name']);
    $extension = strtolower((string)pathinfo($original, PATHINFO_EXTENSION));
    $allowed = ['3mf','stl','obj','step','stp','scad','amf','ply','glb','gltf','fcstd','f3d','blend','skp','zip'];
    if (!in_array($extension, $allowed, true)) throw new RuntimeException('Formato no permitido. Use 3MF, STL, OBJ, STEP/STP, SCAD, AMF, PLY, GLB/GLTF, FreeCAD, Fusion 360, Blender, SketchUp o ZIP.');
    $mime = 'application/octet-stream';
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $detected = (string)$finfo->file((string)$file['tmp_name']);
    if ($detected !== '') $mime = $detected;
    $relativeDir = 'storage/uploads/la_ruda/models/' . date('Y/m');
    $absoluteDir = dirname(__DIR__) . '/' . $relativeDir;
    if (!is_dir($absoluteDir) && !mkdir($absoluteDir, 0775, true) && !is_dir($absoluteDir)) throw new RuntimeException('No se pudo crear la carpeta de modelos 3D.');
    $storedName = date('Ymd_His') . '_' . bin2hex(random_bytes(8)) . '.' . $extension;
    $destination = $absoluteDir . '/' . $storedName;
    if (!move_uploaded_file((string)$file['tmp_name'], $destination)) throw new RuntimeException('No se pudo guardar el modelo 3D.');
    return ['original_name'=>$original,'relative_path'=>$relativeDir.'/'.$storedName,'mime_type'=>$mime,'file_extension'=>$extension,'size_bytes'=>(int)$file['size']];
}

function la_ruda_slug(string $name, ?int $ignoreId = null): string
{
    $ascii = iconv('UTF-8', 'ASCII//TRANSLIT', $name) ?: $name;
    $base = strtolower(trim((string)preg_replace('/[^a-z0-9]+/i', '-', $ascii), '-')) ?: 'producto';
    $slug = $base;
    $suffix = 2;
    while (true) {
        $params = [$slug];
        $sql = 'SELECT id FROM la_ruda_products WHERE slug=?';
        if ($ignoreId) { $sql .= ' AND id<>?'; $params[] = $ignoreId; }
        if (!query_one($sql . ' LIMIT 1', $params)) return $slug;
        $slug = $base . '-' . $suffix++;
    }
}

function la_ruda_sync_order_calendar_event(int $orderId, int $userId): void
{
    ensure_management_calendar_schema();
    $order = query_one('SELECT id,customer_name,order_date,status,calendar_event_id FROM la_ruda_orders WHERE id=?', [$orderId]);
    if (!$order) return;
    $eventId = (int)($order['calendar_event_id'] ?? 0);
    if ($order['status'] === 'cancelado') {
        if ($eventId) execute_sql("DELETE FROM management_calendar_events WHERE id=? AND app_code='apicultura'", [$eventId]);
        execute_sql('UPDATE la_ruda_orders SET calendar_event_id=NULL WHERE id=?', [$orderId]);
        return;
    }
    $eventDate = (new DateTimeImmutable((string)$order['order_date']))->modify('+3 days')->format('Y-m-d');
    $title = 'Armado pedido #' . $orderId . ' · ' . (string)$order['customer_name'];
    $notes = 'Revisar el armado y el avance del pedido de Apiario La Ruda.';
    if ($eventId && query_one("SELECT id FROM management_calendar_events WHERE id=? AND app_code='apicultura'", [$eventId])) {
        execute_sql("UPDATE management_calendar_events SET title=?,event_type='armado_pedido',start_date=?,end_date=NULL,notes=?,color='#8a633e' WHERE id=? AND app_code='apicultura'", [$title,$eventDate,$notes,$eventId]);
    } else {
        execute_sql("INSERT INTO management_calendar_events (app_code,title,event_type,start_date,notes,color,created_by_user_id) VALUES ('apicultura',?,'armado_pedido',?,?,'#8a633e',?)", [$title,$eventDate,$notes,$userId]);
        execute_sql('UPDATE la_ruda_orders SET calendar_event_id=? WHERE id=?', [(int)db()->lastInsertId(),$orderId]);
    }
}

function la_ruda_order_payload(int $orderId): ?array
{
    $order=query_one("SELECT o.*,u.display_name created_by_name FROM la_ruda_orders o LEFT JOIN users u ON u.id=o.created_by_user_id WHERE o.id=?",[$orderId]);
    if(!$order) return null;
    $items=query_all("SELECT i.*,p.name product_name,p.category_name,p.stock_quantity,p.unit,p.photo_relative_path,
        COUNT(pr.id) stage_count,COALESCE(SUM(pr.completed),0) completed_count
        FROM la_ruda_order_items i JOIN la_ruda_products p ON p.id=i.product_id
        LEFT JOIN la_ruda_order_stage_progress pr ON pr.order_item_id=i.id
        WHERE i.order_id=? GROUP BY i.id ORDER BY i.id",[$orderId]);
    foreach($items as &$item){
        $item['stages']=query_all("SELECT pr.*,s.name,s.sort_order,u.display_name completed_by_name FROM la_ruda_order_stage_progress pr JOIN la_ruda_product_stages s ON s.id=pr.stage_id LEFT JOIN users u ON u.id=pr.completed_by_user_id WHERE pr.order_item_id=? ORDER BY s.sort_order,s.id",[(int)$item['id']]);
    }
    unset($item);
    $order['items']=$items;
    return $order;
}

function la_ruda_sync_order_status(int $orderId): void
{
    $order=query_one('SELECT status FROM la_ruda_orders WHERE id=?',[$orderId]);
    if(!$order || in_array($order['status'],['entregado','cancelado'],true)) return;
    $items=(int)(query_one('SELECT COUNT(*) total FROM la_ruda_order_items WHERE order_id=?',[$orderId])['total']??0);
    $counts=query_one("SELECT COUNT(*) total,COALESCE(SUM(pr.completed),0) done FROM la_ruda_order_stage_progress pr JOIN la_ruda_order_items i ON i.id=pr.order_item_id WHERE i.order_id=?",[$orderId]);
    $total=(int)($counts['total']??0);$done=(int)($counts['done']??0);
    $status=$items===0?'ingresado':($total>0&&$done===$total?'listo':($done>0?'produccion':'ingresado'));
    execute_sql('UPDATE la_ruda_orders SET status=? WHERE id=?',[$status,$orderId]);
}

function la_ruda_product_history_payload(int $productId): ?array
{
    $product=query_one("SELECT p.*,(SELECT COUNT(*) FROM la_ruda_product_stages s WHERE s.product_id=p.id AND s.active=1) stage_count FROM la_ruda_products p WHERE p.id=?",[$productId]);
    if(!$product) return null;
    $product['stages']=query_all('SELECT * FROM la_ruda_product_stages WHERE product_id=? AND active=1 ORDER BY sort_order,id',[$productId]);
    $product['movements']=query_all("SELECT m.*,u.display_name created_by_name,o.id order_id,o.customer_name,b.id production_batch_id,s.id sale_id
        FROM la_ruda_stock_movements m
        LEFT JOIN users u ON u.id=m.created_by_user_id
        LEFT JOIN la_ruda_order_items i ON i.id=m.order_item_id
        LEFT JOIN la_ruda_orders o ON o.id=i.order_id
        LEFT JOIN la_ruda_production_batches b ON b.id=m.production_batch_id
        LEFT JOIN la_ruda_sales s ON s.id=m.sale_id
        WHERE m.product_id=? ORDER BY m.movement_date DESC,m.id DESC LIMIT 300",[$productId]);
    $product['production_history']=query_all("SELECT b.*,u.display_name completed_by_name FROM la_ruda_production_batches b LEFT JOIN users u ON u.id=b.completed_by_user_id WHERE b.product_id=? ORDER BY b.production_date DESC,b.id DESC LIMIT 200",[$productId]);
    $product['sales_history']=query_all("SELECT s.*,u.display_name created_by_name FROM la_ruda_sales s LEFT JOIN users u ON u.id=s.created_by_user_id WHERE s.product_id=? ORDER BY s.sale_date DESC,s.id DESC LIMIT 200",[$productId]);
    return $product;
}

function la_ruda_accounting_ids(): array
{
    execute_sql("INSERT IGNORE INTO accounting_people (name) VALUES ('Chiara'),('Felipe'),('Apiario La Ruda')");
    execute_sql("INSERT IGNORE INTO accounting_concepts (name,default_type) VALUES ('Recuperación de insumos','ingreso'),('Venta de insumos','ingreso'),('Fabricación Apiario La Ruda','egreso')");
    $chiara=(int)(query_one("SELECT id FROM accounting_people WHERE LOWER(name)='chiara' LIMIT 1")['id']??0);
    $felipe=(int)(query_one("SELECT id FROM accounting_people WHERE LOWER(name)='felipe' LIMIT 1")['id']??0);
    $general=(int)(query_one("SELECT id FROM accounting_people WHERE name='Apiario La Ruda' LIMIT 1")['id']??0);
    $recovery=(int)(query_one("SELECT id FROM accounting_concepts WHERE name='Recuperación de insumos' LIMIT 1")['id']??0);
    $sale=(int)(query_one("SELECT id FROM accounting_concepts WHERE name='Venta de insumos' LIMIT 1")['id']??0);
    $fabrication=(int)(query_one("SELECT id FROM accounting_concepts WHERE name='Fabricación Apiario La Ruda' LIMIT 1")['id']??0);
    if(!$chiara||!$felipe||!$recovery||!$sale||!$fabrication) throw new RuntimeException('No se pudo preparar la integración contable.');
    return compact('chiara','felipe','general','recovery','sale','fabrication');
}

function la_ruda_handle(string $action): never
{
    $user=la_ruda_user();
    ensure_la_ruda_schema();
    $uid=(int)$user['id'];
    switch($action){
        case 'la_ruda_dashboard':
            $products=query_all("SELECT p.*,(SELECT COUNT(*) FROM la_ruda_product_stages s WHERE s.product_id=p.id AND s.active=1) stage_count FROM la_ruda_products p WHERE p.active=1 ORDER BY COALESCE(NULLIF(p.category_name,''),'Sin categoría'),p.sort_order,p.name");
            foreach($products as &$product){
                $product['stages']=query_all('SELECT * FROM la_ruda_product_stages WHERE product_id=? AND active=1 ORDER BY sort_order,id',[(int)$product['id']]);
                $product['average_cost_ars']=(float)$product['stock_quantity']>0?(float)$product['stock_value_ars']/(float)$product['stock_quantity']:0;
            } unset($product);
            $orders=query_all("SELECT o.*,u.display_name created_by_name,
                (SELECT COUNT(*) FROM la_ruda_order_items i WHERE i.order_id=o.id) item_count,
                (SELECT COALESCE(SUM(i.quantity*i.unit_price),0) FROM la_ruda_order_items i WHERE i.order_id=o.id) total_amount,
                (SELECT COUNT(*) FROM la_ruda_order_stage_progress pr JOIN la_ruda_order_items i ON i.id=pr.order_item_id WHERE i.order_id=o.id) stage_count,
                (SELECT COALESCE(SUM(pr.completed),0) FROM la_ruda_order_stage_progress pr JOIN la_ruda_order_items i ON i.id=pr.order_item_id WHERE i.order_id=o.id) completed_count
                FROM la_ruda_orders o LEFT JOIN users u ON u.id=o.created_by_user_id
                ORDER BY FIELD(o.status,'ingresado','produccion','listo','entregado','cancelado'),o.due_date IS NULL,o.due_date DESC,o.id DESC");
            $fabrication=query_all("SELECT b.*,p.name product_name,p.unit,p.photo_relative_path,
                COUNT(pr.id) stage_count,COALESCE(SUM(pr.completed),0) completed_count,
                u.display_name completed_by_name
                FROM la_ruda_production_batches b
                JOIN la_ruda_products p ON p.id=b.product_id
                LEFT JOIN la_ruda_production_stage_progress pr ON pr.batch_id=b.id
                LEFT JOIN users u ON u.id=b.completed_by_user_id
                WHERE b.status<>'cancelada'
                GROUP BY b.id
                ORDER BY FIELD(b.status,'en_proceso','terminada'),b.production_date DESC,b.id DESC");
            foreach($fabrication as &$batch){
                $batch['stages']=query_all('SELECT * FROM la_ruda_production_stage_progress WHERE batch_id=? ORDER BY sort_order,id',[(int)$batch['id']]);
            } unset($batch);
            $published=query_all("SELECT p.*,(CASE WHEN p.stock_quantity>0 THEN p.stock_value_ars/p.stock_quantity ELSE 0 END) average_cost_ars FROM la_ruda_products p WHERE p.active=1 AND p.published_active=1 ORDER BY p.name");
            $recentSales=query_all("SELECT s.*,p.name product_name,u.display_name created_by_name FROM la_ruda_sales s JOIN la_ruda_products p ON p.id=s.product_id LEFT JOIN users u ON u.id=s.created_by_user_id ORDER BY s.sale_date DESC,s.id DESC LIMIT 100");
            $models=query_all("SELECT m.*,p.name product_name,u.display_name created_by_name FROM la_ruda_3d_models m LEFT JOIN la_ruda_products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.created_by_user_id ORDER BY COALESCE(NULLIF(m.category_name,''),'Sin categoría'),m.name,m.created_at DESC");
            $summary=query_one("SELECT COUNT(*) total,COALESCE(SUM(status IN ('ingresado','produccion')),0) active,COALESCE(SUM(status='listo'),0) ready,COALESCE(SUM(status='entregado'),0) delivered FROM la_ruda_orders");
            $summary['fabricating']=(int)(query_one("SELECT COUNT(*) total FROM la_ruda_production_batches WHERE status='en_proceso'")['total']??0);
            $stockSummary=query_one("SELECT COALESCE(SUM(stock_quantity),0) units,COALESCE(SUM(stock_value_ars),0) value_ars,COALESCE(SUM(stock_value_usd),0) value_usd,COALESCE(SUM(stock_quantity*grams_per_unit),0) grams FROM la_ruda_products WHERE active=1");
            $summary=array_merge($summary?:[],$stockSummary?:[]);
            $summary['models_3d']=count($models);
            api_ok(['products'=>$products,'orders'=>$orders,'fabrication'=>$fabrication,'published'=>$published,'sales'=>$recentSales,'models'=>$models,'summary'=>$summary]);

        case 'la_ruda_model':
            $model=query_one("SELECT m.*,p.name product_name,u.display_name created_by_name FROM la_ruda_3d_models m LEFT JOIN la_ruda_products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.created_by_user_id WHERE m.id=?",[(int)($_GET['id']??0)]);if(!$model)api_fail('El modelo 3D no existe.',404);api_ok(['model'=>$model]);
        case 'la_ruda_model_save':
            api_require_method('POST');$d=api_input();if(empty($d)&&empty($_FILES)&&(int)($_SERVER['CONTENT_LENGTH']??0)>0)api_fail('El archivo no llegó al servidor. Probablemente supera el límite de carga configurado en PHP.',413);$id=api_int($d,'id');$name=api_string($d,'name');if(!$name)api_fail('Indique el nombre del modelo.');
            $old=$id?query_one('SELECT * FROM la_ruda_3d_models WHERE id=?',[$id]):null;if($id&&!$old)api_fail('El modelo 3D no existe.',404);
            $productId=api_int($d,'product_id');if($productId&&!query_one('SELECT id FROM la_ruda_products WHERE id=?',[$productId]))api_fail('El producto relacionado no existe.');
            $file=la_ruda_upload_3d_model();if(!$old&&!$file)api_fail('Seleccione el archivo del modelo 3D.');
            $original=$file['original_name']??($old['original_name']??'');$path=$file['relative_path']??($old['relative_path']??'');$mime=$file['mime_type']??($old['mime_type']??'application/octet-stream');$extension=$file['file_extension']??($old['file_extension']??'');$size=$file['size_bytes']??($old['size_bytes']??0);
            if($id){execute_sql('UPDATE la_ruda_3d_models SET name=?,product_id=?,category_name=?,version_label=?,description=?,original_name=?,relative_path=?,mime_type=?,file_extension=?,size_bytes=? WHERE id=?',[$name,$productId?:null,api_string($d,'category_name')?:null,api_string($d,'version_label')?:null,api_string($d,'description')?:null,$original,$path,$mime,$extension,$size,$id]);if($file&&!empty($old['relative_path']))api_delete_file($old['relative_path']);}
            else{execute_sql('INSERT INTO la_ruda_3d_models (name,product_id,category_name,version_label,description,original_name,relative_path,mime_type,file_extension,size_bytes,created_by_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[$name,$productId?:null,api_string($d,'category_name')?:null,api_string($d,'version_label')?:null,api_string($d,'description')?:null,$original,$path,$mime,$extension,$size,$uid]);$id=(int)db()->lastInsertId();}
            api_ok(['id'=>$id],$old?'Modelo 3D actualizado.':'Modelo 3D guardado.');
        case 'la_ruda_model_delete':
            api_require_method('POST');$id=api_int(api_input(),'id',0)??0;$model=query_one('SELECT relative_path FROM la_ruda_3d_models WHERE id=?',[$id]);if(!$model)api_fail('El modelo 3D no existe.',404);execute_sql('DELETE FROM la_ruda_3d_models WHERE id=?',[$id]);api_delete_file($model['relative_path']??null);api_ok([],'Modelo 3D eliminado.');

        case 'la_ruda_order':
            $order=la_ruda_order_payload((int)($_GET['id']??0));if(!$order)api_fail('El pedido no existe.',404);api_ok(['order'=>$order]);
        case 'la_ruda_order_save':
            api_require_method('POST');$d=api_input();$id=api_int($d,'id');$customer=api_string($d,'customer_name');$date=api_string($d,'order_date',date('Y-m-d'));if(!$customer)api_fail('Indique el cliente.');
            $vals=[$customer,api_string($d,'customer_contact')?:null,$date,api_string($d,'due_date')?:null,api_string($d,'notes')?:null];
            if($id){if(!query_one('SELECT id FROM la_ruda_orders WHERE id=?',[$id]))api_fail('El pedido no existe.',404);execute_sql('UPDATE la_ruda_orders SET customer_name=?,customer_contact=?,order_date=?,due_date=?,notes=? WHERE id=?',[...$vals,$id]);}
            else{execute_sql("INSERT INTO la_ruda_orders (customer_name,customer_contact,order_date,due_date,notes,created_by_user_id) VALUES (?,?,?,?,?,?)",[...$vals,$uid]);$id=(int)db()->lastInsertId();}
            la_ruda_sync_order_calendar_event((int)$id,$uid); google_calendar_sync_app_best_effort('apicultura');
            api_ok(['id'=>$id],'Pedido guardado. Se agregó al calendario el control de armado a los 3 días.');
        case 'la_ruda_order_delete':
            api_require_method('POST');$id=api_int(api_input(),'id',0)??0;$row=query_one('SELECT calendar_event_id FROM la_ruda_orders WHERE id=?',[$id]);if($row&&!empty($row['calendar_event_id']))execute_sql("DELETE FROM management_calendar_events WHERE id=? AND app_code='apicultura'",[(int)$row['calendar_event_id']]);execute_sql('DELETE FROM la_ruda_orders WHERE id=?',[$id]);google_calendar_sync_app_best_effort('apicultura');api_ok([],'Pedido eliminado.');
        case 'la_ruda_order_status':
            api_require_method('POST');$d=api_input();$id=api_int($d,'id',0)??0;$status=api_string($d,'status');if(!in_array($status,['ingresado','produccion','listo','entregado','cancelado'],true))api_fail('Estado inválido.');execute_sql("UPDATE la_ruda_orders SET status=?,delivered_at=IF(?='entregado',COALESCE(delivered_at,NOW()),NULL) WHERE id=?",[$status,$status,$id]);la_ruda_sync_order_calendar_event($id,$uid);google_calendar_sync_app_best_effort('apicultura');api_ok([],'Estado actualizado.');
        case 'la_ruda_item_save':
            api_require_method('POST');$d=api_input();$orderId=api_int($d,'order_id',0)??0;$productId=api_int($d,'product_id',0)??0;$qty=max(1,(int)round(api_decimal($d,'quantity',1)));if(!query_one('SELECT id FROM la_ruda_orders WHERE id=?',[$orderId]))api_fail('El pedido no existe.');if(!query_one('SELECT id FROM la_ruda_products WHERE id=? AND active=1',[$productId]))api_fail('Seleccione un producto.');
            execute_sql('INSERT INTO la_ruda_order_items (order_id,product_id,quantity,unit_price,notes) VALUES (?,?,?,?,?)',[$orderId,$productId,$qty,max(0,api_decimal($d,'unit_price')),api_string($d,'notes')?:null]);$itemId=(int)db()->lastInsertId();
            execute_sql('INSERT IGNORE INTO la_ruda_order_stage_progress (order_item_id,stage_id) SELECT ?,id FROM la_ruda_product_stages WHERE product_id=? AND active=1 ORDER BY sort_order,id',[$itemId,$productId]);la_ruda_sync_order_status($orderId);api_ok(['id'=>$itemId],'Producto agregado al pedido.');
        case 'la_ruda_item_delete':
            api_require_method('POST');$id=api_int(api_input(),'id',0)??0;$row=query_one('SELECT order_id,manufacturing_completed_at FROM la_ruda_order_items WHERE id=?',[$id]);if($row&&$row['manufacturing_completed_at'])api_fail('No se puede quitar: esta fabricación ya ingresó al stock.');if($row){execute_sql('DELETE FROM la_ruda_order_items WHERE id=?',[$id]);la_ruda_sync_order_status((int)$row['order_id']);}api_ok([],'Producto quitado.');
        case 'la_ruda_stage_toggle':
            api_require_method('POST');$d=api_input();$id=api_int($d,'id',0)??0;$done=api_int($d,'completed',0)?1:0;$row=query_one('SELECT i.order_id FROM la_ruda_order_stage_progress pr JOIN la_ruda_order_items i ON i.id=pr.order_item_id WHERE pr.id=?',[$id]);if(!$row)api_fail('La etapa no existe.',404);execute_sql('UPDATE la_ruda_order_stage_progress SET completed=?,completed_at=?,completed_by_user_id=? WHERE id=?',[$done,$done?date('Y-m-d H:i:s'):null,$done?$uid:null,$id]);la_ruda_sync_order_status((int)$row['order_id']);api_ok([],$done?'Etapa completada.':'Etapa reabierta.');

        case 'la_ruda_product_save':
            api_require_method('POST');$d=api_input();$id=api_int($d,'id');$name=api_string($d,'name');if(!$name)api_fail('Indique el nombre.');$grams=max(0,(int)round(api_decimal($d,'grams_per_unit')));if($grams<=0)api_fail('Indique cuántos gramos de material usa cada unidad.');
            $old=$id?query_one('SELECT * FROM la_ruda_products WHERE id=? AND active=1',[$id]):null;if($id&&!$old)api_fail('El producto no existe.',404);
            $file=null;if(isset($_FILES['photo'])&&($_FILES['photo']['error']??UPLOAD_ERR_NO_FILE)!==UPLOAD_ERR_NO_FILE){$file=api_upload('photo','la_ruda/products');if($file&&!str_starts_with((string)$file['mime_type'],'image/')){api_delete_file($file['relative_path']);api_fail('La foto debe ser JPG, PNG o WEBP.');}}
            $photoName=$file['original_name']??($old['photo_original_name']??null);$photoPath=$file['relative_path']??($old['photo_relative_path']??null);$photoMime=$file['mime_type']??($old['photo_mime_type']??null);
            if($file&&$old&&!empty($old['photo_relative_path']))api_delete_file($old['photo_relative_path']);
            $category=api_string($d,'category_name')?:null;$notes=api_string($d,'notes')?:null;$slug=la_ruda_slug($name,$id?:null);
            if($id){execute_sql("UPDATE la_ruda_products SET name=?,slug=?,category_name=?,production_mode='por_pedido',unit='unidad',grams_per_unit=?,notes=?,photo_original_name=?,photo_relative_path=?,photo_mime_type=? WHERE id=?",[$name,$slug,$category,$grams,$notes,$photoName,$photoPath,$photoMime,$id]);}
            else{execute_sql("INSERT INTO la_ruda_products (name,slug,category_name,business_line,production_mode,unit,grams_per_unit,notes,photo_original_name,photo_relative_path,photo_mime_type,sort_order) VALUES (?,?,?,'insumos','por_pedido','unidad',?,?,?,?,?,999)",[$name,$slug,$category,$grams,$notes,$photoName,$photoPath,$photoMime]);$id=(int)db()->lastInsertId();}
            execute_sql('UPDATE la_ruda_product_stages SET active=0 WHERE product_id=?',[$id]);
            $stages=array_values(array_filter(array_map('trim',preg_split('/\r?\n/',api_string($d,'stages'))?:[])));if(!$stages)$stages=['Impresión 3D','Armado','Control final'];
            foreach($stages as $i=>$stage){execute_sql('INSERT INTO la_ruda_product_stages (product_id,name,sort_order,active) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE sort_order=VALUES(sort_order),active=1',[$id,$stage,($i+1)*10]);}
            api_ok(['id'=>$id],$old?'Producto actualizado.':'Producto creado.');
        case 'la_ruda_product_history':
            $product=la_ruda_product_history_payload((int)($_GET['id']??0));if(!$product)api_fail('El producto no existe.',404);api_ok(['product'=>$product]);
        case 'la_ruda_product_delete':
            api_require_method('POST');$id=api_int(api_input(),'id',0)??0;if(!query_one('SELECT id FROM la_ruda_products WHERE id=? AND active=1',[$id]))api_fail('El producto no existe.',404);execute_sql('UPDATE la_ruda_products SET active=0,published_active=0 WHERE id=?',[$id]);api_ok([],'Producto eliminado del catálogo. El historial se conserva.');
        case 'la_ruda_product_publish':
            api_require_method('POST');$d=api_input();$id=api_int($d,'id',0)??0;$active=api_int($d,'published_active',0)?1:0;$price=max(0,api_decimal($d,'sale_price_ars'));if($active&&$price<=0)api_fail('Indique el precio de venta.');execute_sql('UPDATE la_ruda_products SET published_active=?,sale_price_ars=? WHERE id=? AND active=1',[$active,$price,$id]);api_ok([],$active?'Artículo publicado.':'Artículo retirado de publicados.');

        case 'la_ruda_production_save':
            api_require_method('POST');$d=api_input();$productId=api_int($d,'product_id',0)??0;$quantity=max(1,(int)round(api_decimal($d,'quantity',1)));$priceKg=api_decimal($d,'material_price_per_kg_ars');$rate=api_decimal($d,'usd_rate');$product=query_one('SELECT id,name,grams_per_unit FROM la_ruda_products WHERE id=? AND active=1',[$productId]);if(!$product)api_fail('Seleccione un producto.');if((int)$product['grams_per_unit']<=0)api_fail('El producto no tiene configurados los gramos por unidad.');if($priceKg<=0||$rate<=0)api_fail('Indique precio por kilo y cotización del dólar.');
            $totalGrams=(int)$product['grams_per_unit']*$quantity;$costArs=($totalGrams/1000)*$priceKg;$costUsd=$costArs/$rate;
            execute_sql("INSERT INTO la_ruda_production_batches (product_id,production_date,quantity,grams_per_unit,total_grams,material_price_per_kg_ars,usd_rate,material_cost_ars,material_cost_usd,notes,created_by_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",[$productId,api_string($d,'production_date',date('Y-m-d')),$quantity,(int)$product['grams_per_unit'],$totalGrams,$priceKg,$rate,$costArs,$costUsd,api_string($d,'notes')?:null,$uid]);$batchId=(int)db()->lastInsertId();
            $stages=query_all('SELECT name,sort_order FROM la_ruda_product_stages WHERE product_id=? AND active=1 ORDER BY sort_order,id',[$productId]);if(!$stages)$stages=[['name'=>'Fabricación','sort_order'=>10],['name'=>'Control final','sort_order'=>20]];foreach($stages as $stage)execute_sql('INSERT INTO la_ruda_production_stage_progress (batch_id,stage_name,sort_order) VALUES (?,?,?)',[$batchId,$stage['name'],$stage['sort_order']]);
            api_ok(['id'=>$batchId,'total_grams'=>$totalGrams,'material_cost_ars'=>$costArs,'material_cost_usd'=>$costUsd],'Fabricación iniciada.');
        case 'la_ruda_production_stage_toggle':
            api_require_method('POST');$d=api_input();$id=api_int($d,'id',0)??0;$done=api_int($d,'completed',0)?1:0;$row=query_one('SELECT b.status FROM la_ruda_production_stage_progress pr JOIN la_ruda_production_batches b ON b.id=pr.batch_id WHERE pr.id=?',[$id]);if(!$row)api_fail('La etapa no existe.',404);if($row['status']!=='en_proceso')api_fail('La fabricación ya está cerrada.');execute_sql('UPDATE la_ruda_production_stage_progress SET completed=?,completed_at=?,completed_by_user_id=? WHERE id=?',[$done,$done?date('Y-m-d H:i:s'):null,$done?$uid:null,$id]);api_ok([],$done?'Etapa completada.':'Etapa reabierta.');
        case 'la_ruda_production_complete':
            api_require_method('POST');$batchId=api_int(api_input(),'batch_id',0)??0;$pdo=db();$pdo->beginTransaction();
            try{
                $batch=query_one("SELECT b.*,p.name product_name,p.stock_quantity,p.stock_value_ars,p.stock_value_usd FROM la_ruda_production_batches b JOIN la_ruda_products p ON p.id=b.product_id WHERE b.id=? FOR UPDATE",[$batchId]);
                if(!$batch)throw new RuntimeException('La fabricación no existe.');
                if($batch['status']==='terminada'){ $pdo->rollBack(); api_ok(['accounting_entry_id'=>$batch['accounting_entry_id']??null],'La fabricación ya estaba confirmada.'); }
                if($batch['status']!=='en_proceso')throw new RuntimeException('La fabricación está cancelada.');
                $count=query_one('SELECT COUNT(*) total,COALESCE(SUM(completed),0) done FROM la_ruda_production_stage_progress WHERE batch_id=?',[$batchId]);
                if((int)($count['total']??0)===0||(int)$count['total']!==(int)$count['done'])throw new RuntimeException('Complete todas las etapas antes de confirmar.');
                $note='Fabricación #'.$batchId.' · '.(string)$batch['product_name'].' · '.(int)$batch['total_grams'].' g usados';
                execute_sql("INSERT INTO la_ruda_stock_movements (product_id,movement_date,movement_type,quantity_change,notes,production_batch_id,grams_used,material_cost_ars,material_cost_usd,created_by_user_id) VALUES (?,?,'entrada',?,?,?,?,?,?,?)",[(int)$batch['product_id'],$batch['production_date'],(int)$batch['quantity'],$note,$batchId,(int)$batch['total_grams'],(float)$batch['material_cost_ars'],(float)$batch['material_cost_usd'],$uid]);
                $movementId=(int)$pdo->lastInsertId();
                execute_sql('UPDATE la_ruda_products SET stock_quantity=stock_quantity+?,stock_value_ars=stock_value_ars+?,stock_value_usd=stock_value_usd+? WHERE id=?',[(int)$batch['quantity'],(float)$batch['material_cost_ars'],(float)$batch['material_cost_usd'],(int)$batch['product_id']]);
                $ids=la_ruda_accounting_ids();$accountingEntryId=null;
                if((float)$batch['material_cost_ars']>0){
                    execute_sql("INSERT INTO accounting_entries (entry_date,person_id,movement_type,concept_id,amount_ars,usd_rate,amount_usd,description) VALUES (?,?,'egreso',?,?,?,?,?)",[$batch['production_date'],$ids['chiara'],$ids['fabrication'],(float)$batch['material_cost_ars'],(float)$batch['usd_rate'],(float)$batch['material_cost_usd'],$note.' · costo de material a recuperar por Chiara']);
                    $accountingEntryId=(int)$pdo->lastInsertId();
                }
                execute_sql("UPDATE la_ruda_production_batches SET status='terminada',completed_at=NOW(),completed_by_user_id=?,stock_movement_id=?,accounting_entry_id=? WHERE id=?",[$uid,$movementId,$accountingEntryId,$batchId]);
                $pdo->commit();
                api_ok(['stock_movement_id'=>$movementId,'accounting_entry_id'=>$accountingEntryId],'Fabricación terminada. Se agregó al stock y el costo quedó registrado a nombre de Chiara.');
            }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();api_fail($e->getMessage());}
        case 'la_ruda_production_delete':
            api_require_method('POST');$id=api_int(api_input(),'id',0)??0;$row=query_one('SELECT status FROM la_ruda_production_batches WHERE id=?',[$id]);if(!$row)api_fail('La fabricación no existe.',404);if($row['status']==='terminada')api_fail('No se puede eliminar una fabricación ya ingresada al stock.');execute_sql("UPDATE la_ruda_production_batches SET status='cancelada' WHERE id=?",[$id]);api_ok([],'Fabricación cancelada.');

        case 'la_ruda_stock_adjust':
            api_require_method('POST');$d=api_input();$productId=api_int($d,'product_id',0)??0;$change=(int)round(api_decimal($d,'quantity_change'));if($change===0)api_fail('Indique una cantidad entera distinta de cero.');$product=query_one('SELECT * FROM la_ruda_products WHERE id=? AND active=1',[$productId]);if(!$product)api_fail('El producto no existe.',404);$newQty=(float)$product['stock_quantity']+$change;if($newQty<0)api_fail('El movimiento dejaría el stock en negativo.');$valueChange=0.0;$usdChange=0.0;
            if($change>0){$valueChange=max(0,api_decimal($d,'value_change_ars'));$rate=api_decimal($d,'usd_rate');if($valueChange>0&&$rate<=0)api_fail('Indique la cotización para valorar el ingreso.');$usdChange=$valueChange>0?$valueChange/$rate:0;}
            else{$ratio=(float)$product['stock_quantity']>0?abs($change)/(float)$product['stock_quantity']:0;$valueChange=-min((float)$product['stock_value_ars'],(float)$product['stock_value_ars']*$ratio);$usdChange=-min((float)$product['stock_value_usd'],(float)$product['stock_value_usd']*$ratio);}
            $type=$change>0?'entrada':'salida';execute_sql('INSERT INTO la_ruda_stock_movements (product_id,movement_date,movement_type,quantity_change,notes,material_cost_ars,material_cost_usd,created_by_user_id) VALUES (?,?,?,?,?,?,?,?)',[$productId,api_string($d,'movement_date',date('Y-m-d')),$type,$change,api_string($d,'notes')?:null,$valueChange,$usdChange,$uid]);execute_sql('UPDATE la_ruda_products SET stock_quantity=stock_quantity+?,stock_value_ars=GREATEST(0,stock_value_ars+?),stock_value_usd=GREATEST(0,stock_value_usd+?) WHERE id=?',[$change,$valueChange,$usdChange,$productId]);api_ok([],'Stock actualizado.');

        case 'la_ruda_sale_save':
            api_require_method('POST');$d=api_input();$productId=api_int($d,'product_id',0)??0;$quantity=max(1,(int)round(api_decimal($d,'quantity',1)));$unitPrice=api_decimal($d,'unit_sale_price_ars');$rate=api_decimal($d,'usd_rate');if($unitPrice<=0||$rate<=0)api_fail('Indique precio de venta y cotización.');$pdo=db();$pdo->beginTransaction();
            try{
                $product=query_one('SELECT * FROM la_ruda_products WHERE id=? AND active=1 FOR UPDATE',[$productId]);
                if(!$product)throw new RuntimeException('El producto no existe.');if((float)$product['stock_quantity']<$quantity)throw new RuntimeException('No hay stock suficiente.');
                $saleTotal=$unitPrice*$quantity;$avgCost=(float)$product['stock_quantity']>0?(float)$product['stock_value_ars']/(float)$product['stock_quantity']:0;$avgCostUsd=(float)$product['stock_quantity']>0?(float)$product['stock_value_usd']/(float)$product['stock_quantity']:0;
                $recovery=$avgCost*$quantity;$recoveryStockUsd=$avgCostUsd*$quantity;if($saleTotal+0.0001<$recovery)throw new RuntimeException('El precio de venta no alcanza a cubrir el costo del material de estas unidades.');
                $profit=max(0,$saleTotal-$recovery);
                $ids=la_ruda_accounting_ids();$date=api_string($d,'sale_date',date('Y-m-d'));$buyer=api_string($d,'buyer')?:null;$notes=api_string($d,'notes')?:null;
                $baseDescription='Venta Apiario La Ruda · '.(string)$product['name'].' · '.$quantity.' unidades'.($buyer?' · '.$buyer:'');
                $recoveryEntry=null;
                if($recovery>0){execute_sql("INSERT INTO accounting_entries (entry_date,person_id,movement_type,concept_id,amount_ars,usd_rate,amount_usd,description) VALUES (?,?,'ingreso',?,?,?,?,?)",[$date,$ids['chiara'],$ids['recovery'],$recovery,$rate,$recovery/$rate,$baseDescription.' · recuperación del material']);$recoveryEntry=(int)$pdo->lastInsertId();}
                $profitAllocation=apiculture_income_allocation($profit);$chiaraProfit=(float)$profitAllocation[0]['amount'];$felipeProfit=(float)$profitAllocation[1]['amount'];
                execute_sql("INSERT INTO la_ruda_sales (product_id,sale_date,quantity,unit_sale_price_ars,total_sale_ars,usd_rate,total_sale_usd,material_cost_recovered_ars,material_cost_recovered_usd,profit_ars,profit_usd,chiara_profit_ars,chiara_profit_usd,felipe_profit_ars,felipe_profit_usd,buyer,notes,created_by_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[$productId,$date,$quantity,$unitPrice,$saleTotal,$rate,$saleTotal/$rate,$recovery,$recovery/$rate,$profit,$profit/$rate,$chiaraProfit,$chiaraProfit/$rate,$felipeProfit,$felipeProfit/$rate,$buyer,$notes,$uid]);
                $saleId=(int)$pdo->lastInsertId();$chiaraProfitEntry=null;$felipeProfitEntry=null;
                if($chiaraProfit>0){execute_sql("INSERT INTO accounting_entries (entry_date,person_id,movement_type,concept_id,amount_ars,usd_rate,amount_usd,description) VALUES (?,?,'ingreso',?,?,?,?,?)",[$date,$ids['chiara'],$ids['sale'],$chiaraProfit,$rate,$chiaraProfit/$rate,$baseDescription.' · parte de la venta']);$chiaraProfitEntry=(int)$pdo->lastInsertId();}
                if($felipeProfit>0){execute_sql("INSERT INTO accounting_entries (entry_date,person_id,movement_type,concept_id,amount_ars,usd_rate,amount_usd,description) VALUES (?,?,'ingreso',?,?,?,?,?)",[$date,$ids['felipe'],$ids['sale'],$felipeProfit,$rate,$felipeProfit/$rate,$baseDescription.' · parte de la venta']);$felipeProfitEntry=(int)$pdo->lastInsertId();}
                execute_sql('UPDATE la_ruda_sales SET chiara_accounting_entry_id=?,general_accounting_entry_id=NULL,chiara_profit_accounting_entry_id=?,felipe_profit_accounting_entry_id=? WHERE id=?',[$recoveryEntry,$chiaraProfitEntry,$felipeProfitEntry,$saleId]);
                execute_sql("INSERT INTO la_ruda_stock_movements (product_id,movement_date,movement_type,quantity_change,notes,sale_id,material_cost_ars,material_cost_usd,created_by_user_id) VALUES (?,?,'salida',?,?,?,?,?,?)",[$productId,$date,-$quantity,$baseDescription,$saleId,-$recovery,-$recoveryStockUsd,$uid]);
                execute_sql('UPDATE la_ruda_products SET stock_quantity=stock_quantity-?,stock_value_ars=GREATEST(0,stock_value_ars-?),stock_value_usd=GREATEST(0,stock_value_usd-?) WHERE id=?',[$quantity,$recovery,$recoveryStockUsd,$productId]);
                $pdo->commit();api_ok(['id'=>$saleId,'recovery_ars'=>$recovery,'profit_ars'=>$profit,'chiara_profit_ars'=>$chiaraProfit,'felipe_profit_ars'=>$felipeProfit],'Venta registrada y distribuida entre Chiara y Felipe.');
            }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();api_fail($e->getMessage());}

        default: api_fail('Acción de Apiario La Ruda no reconocida.',404);
    }
}
