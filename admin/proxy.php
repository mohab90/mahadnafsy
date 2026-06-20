<?php
/**
 * admin/proxy.php — Same-origin API proxy for admin.mahadnafsy.com
 * Forwards all /api/* requests directly to Node.js on port 3001
 * No CORS needed — admin panel calls this same-origin endpoint
 */
$target_base = 'http://127.0.0.1:3001';

// Strip /api prefix from URI — admin .htaccess rewrites /api/foo -> proxy.php?_path=/api/foo
$uri = isset($_GET['_path']) ? $_GET['_path'] : $_SERVER['REQUEST_URI'];
// Remove query string from _path (it's already in REQUEST_URI)
if (isset($_GET['_path'])) {
    // Reconstruct full URI with original query string minus _path param
    $qs = $_SERVER['QUERY_STRING'];
    $qs = preg_replace('/(^|&)_path=[^&]*/', '', $qs);
    $qs = ltrim($qs, '&');
    $uri = $uri . ($qs ? '?' . $qs : '');
} else {
    $uri = $_SERVER['REQUEST_URI'];
}

$target_url = $target_base . $uri;
$method     = $_SERVER['REQUEST_METHOD'];
$req_body   = in_array($method, array('POST', 'PUT', 'PATCH')) ? file_get_contents('php://input') : null;

$skip_req = array('host', 'connection', 'accept-encoding', 'content-length');
$forward  = array();
foreach (getallheaders() as $name => $value) {
    if (in_array(strtolower($name), $skip_req)) continue;
    $forward[] = "$name: $value";
}

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL,            $target_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
curl_setopt($ch, CURLOPT_TIMEOUT,        30);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);

if ($method === 'POST') {
    curl_setopt($ch, CURLOPT_POST,       true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $req_body !== null ? $req_body : '');
} elseif (in_array($method, array('PUT', 'PATCH', 'DELETE'))) {
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    if ($method !== 'DELETE' && $req_body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $req_body);
    }
}
if (!empty($forward)) {
    curl_setopt($ch, CURLOPT_HTTPHEADER, $forward);
}

$resp_headers = array();
curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, $h) use (&$resp_headers) {
    $resp_headers[] = trim($h);
    return strlen($h);
});

$body   = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error  = curl_error($ch);
curl_close($ch);

if ($error || $body === false || $status === 0) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('error' => 'API server temporarily unavailable.'));
    exit;
}

http_response_code($status);

// Forward Node.js headers — skip ones we control
$skip_resp = array('transfer-encoding', 'connection', 'keep-alive', 'content-length',
                   'access-control-allow-origin', 'access-control-allow-credentials',
                   'access-control-allow-methods', 'access-control-allow-headers',
                   'vary', 'cache-control', 'etag', 'expires', 'pragma');
foreach ($resp_headers as $h) {
    if (!$h || strpos($h, 'HTTP/') === 0) continue;
    $parts = explode(':', $h, 2);
    if (count($parts) < 2) continue;
    if (in_array(strtolower(trim($parts[0])), $skip_resp)) continue;
    header($h, false);
}

// Same-origin: no CORS headers needed
header('Cache-Control: no-store, no-cache, must-revalidate');
echo $body;
