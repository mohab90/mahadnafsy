<?php
/**
 * api-proxy.php — PHP reverse proxy for admin.mahadnafsy.com
 * Forwards /api/* requests to the main domain (mahadnafsy.com) which has its
 * own working proxy to Node.js port 3001.
 *
 * NOTE: We do NOT proxy to 127.0.0.1:3001 directly because on Hostinger shared
 * hosting the admin subdomain PHP pool runs in a different context that cannot
 * reach localhost ports opened by other domains.
 */

// Route all /api/* requests through the main domain's working API proxy
$target_base = 'https://mahadnafsy.com';

$uri        = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/api/health';
$target_url = $target_base . $uri;

$method   = $_SERVER['REQUEST_METHOD'];
$req_body = in_array($method, array('POST', 'PUT', 'PATCH')) ? file_get_contents('php://input') : null;

$skip_req = array('host', 'connection', 'accept-encoding', 'content-length');
$forward  = array();
foreach (getallheaders() as $name => $value) {
    if (in_array(strtolower($name), $skip_req)) continue;
    $forward[] = "$name: $value";
}

function do_proxy_request($target_url, $method, $req_body, $forward) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL,            $target_url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
    curl_setopt($ch, CURLOPT_TIMEOUT,        30);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 2);

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
    $status = $status ? $status : 0;
    $error  = curl_error($ch);
    curl_close($ch);

    return array($body, $status, $error, $resp_headers);
}

$result       = do_proxy_request($target_url, $method, $req_body, $forward);
$body         = $result[0];
$status       = $result[1];
$error        = $result[2];
$resp_headers = $result[3];

if ($error || $body === false || $status === 0) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Retry-After: 10');
    echo json_encode(array('error' => 'API server temporarily unavailable. Please retry in a moment.'));
    exit;
}

http_response_code($status);

$skip_resp = array('transfer-encoding', 'connection', 'keep-alive', 'content-length');
foreach ($resp_headers as $h) {
    if (!$h || strpos($h, 'HTTP/') === 0) continue;
    $parts = explode(':', $h, 2);
    if (count($parts) < 2) continue;
    if (in_array(strtolower(trim($parts[0])), $skip_resp)) continue;
    header($h, false);
}

echo $body;
