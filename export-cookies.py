import os, sys, sqlite3, shutil, tempfile, platform

def get_possible_cookie_paths():
    system = platform.system()
    paths = []

    if system == 'Darwin':
        app_support = os.path.expanduser('~/Library/Application Support')
        browsers = [
            os.path.join(app_support, 'Google/Chrome/Default/Cookies'),
            os.path.join(app_support, 'Google/Chrome/Profile 1/Cookies'),
            os.path.join(app_support, 'Chromium/Default/Cookies'),
            os.path.join(app_support, 'BraveSoftware/Brave-Browser/Default/Cookies'),
            os.path.join(app_support, 'Microsoft Edge/Default/Cookies'),
            os.path.join(app_support, 'Yandex/YandexBrowser/Default/Cookies'),
        ]
        paths.extend(browsers)

    elif system == 'Windows':
        local_app_data = os.environ.get('LOCALAPPDATA') or os.path.expanduser('~\\AppData\\Local')
        browsers = [
            os.path.join(local_app_data, r'Google\Chrome\User Data\Default\Network\Cookies'),
            os.path.join(local_app_data, r'Google\Chrome\User Data\Default\Cookies'),
            os.path.join(local_app_data, r'Google\Chrome\User Data\Profile 1\Network\Cookies'),
            os.path.join(local_app_data, r'Microsoft\Edge\User Data\Default\Network\Cookies'),
            os.path.join(local_app_data, r'Microsoft\Edge\User Data\Default\Cookies'),
            os.path.join(local_app_data, r'BraveSoftware\Brave-Browser\User Data\Default\Network\Cookies'),
            os.path.join(local_app_data, r'Yandex\YandexBrowser\User Data\Default\Network\Cookies'),
        ]
        paths.extend(browsers)

    else:  # Linux and other Unix-like
        config = os.environ.get('XDG_CONFIG_HOME') or os.path.expanduser('~/.config')
        browsers = [
            os.path.join(config, 'google-chrome/Default/Cookies'),
            os.path.join(config, 'google-chrome/Profile 1/Cookies'),
            os.path.join(config, 'chromium/Default/Cookies'),
            os.path.join(config, 'BraveSoftware/Brave-Browser/Default/Cookies'),
            os.path.join(config, 'microsoft-edge/Default/Cookies'),
            os.path.join(config, 'yandex-browser/Default/Cookies'),
        ]
        paths.extend(browsers)

    return paths

def export_cookies():
    possible_paths = get_possible_cookie_paths()
    cookie_db = None
    for p in possible_paths:
        if p and os.path.exists(p):
            cookie_db = p
            break
    if not cookie_db:
        return

    tmp_dir = tempfile.mkdtemp()
    tmp_db = os.path.join(tmp_dir, 'Cookies')
    try:
        shutil.copy2(cookie_db, tmp_db)
        conn = sqlite3.connect(tmp_db)
        cursor = conn.cursor()
        cursor.execute("SELECT host_key, path, is_secure, expires_utc, name, value, encrypted_value FROM cookies WHERE host_key LIKE '%yandex%' OR host_key LIKE '%youtube%' OR host_key LIKE '%google%'")
        rows = cursor.fetchall()

        out_path = sys.argv[1] if len(sys.argv) > 1 else '.cache/cookies.txt'
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write("# Netscape HTTP Cookie File\n")
            for host, path_val, is_sec, exp, name, val, enc_val in rows:
                if val:
                    exp_sec = exp // 1000000 if exp else 0
                    f.write(f"{host}\tTRUE\t{path_val}\t{'TRUE' if is_sec else 'FALSE'}\t{exp_sec}\t{name}\t{val}\n")
        conn.close()
    except Exception:
        pass
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

if __name__ == '__main__':
    export_cookies()
