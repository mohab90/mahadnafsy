<?php
/**
 * admin/api/index.php — Same-origin API proxy for admin.mahadnafsy.com
 * Receives: admin.mahadnafsy.com/api/courses?limit=200
 * Forwards:  http://127.0.0.1:3001/api/courses?limit=200
 * No CORS headers needed — same origin!
 */
$target_base = 'http://127.0.0.1:3001';

// Full URI including query string
$uri = $_SERVER['REQUEST_URI'];

// If REQUEST_URI starts with /api, use it directly
// (it would be /api/courses?limit=200 etc.)
$target_url = $target_base . $uri;

$method   = $_SERVER['REQUEST_METHOD'];
$req_body = in_array($method, ['POST', 'PUT', 'PATCH']) ? file_get_contents('php://input') : null;

$skip_req = ['host', 'connection', 'accept-encoding', 'content-length'];
$forward  = [];
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
    curl_setopt($ch, CURLOPT_POSTFIELDS, $req_body ?? '');
} elseif (in_array($method, ['PUT', 'PATCH', 'DELETE'])) {
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    if ($method !== 'DELETE' && $req_body !== null)
        curl_setopt($ch, CURLOPT_POSTFIELDS, $req_body);
}
if (!empty($forward))
    curl_setopt($ch, CURLOPT_HTTPHEADER, $forward);

$resp_headers = [];
curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, $h) use (&$resp_headers) {
    $resp_headers[] = trim($h);
    return strlen($h);
});

$body   = curl_exec($ch);
$status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error  = curl_error($ch);
curl_close($ch);

if ($error || $body === false || $status === 0) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'API server temporarily unavailable.']);
    exit;
}

http_response_code($status);

$skip_resp = ['transfer-encoding', 'connection', 'keep-alive', 'content-length',
              'access-control-allow-origin', 'access-control-allow-credentials',
              'access-control-allow-methods', 'access-control-allow-headers',
              'vary', 'cache-control', 'etag', 'expires', 'pragma'];
foreach ($resp_headers as $h) {
    if (!$h || str_starts_with($h, 'HTTP/')) continue;
    $parts = explode(':', $h, 2);
    if (count($parts) < 2) continue;
    if (in_array(strtolower(trim($parts[0])), $skip_resp)) continue;
    header($h, false);
}

header('Cache-Control: no-store, no-cache, must-revalidate');
echo $body;
