import os
import sys

# Extract PORT from environment or fallback to 8000
port = os.environ.get("PORT", "8000")

# Render sometimes injects GUNICORN_CMD_ARGS="--bind=0.0.0.0:10000" in its default python container
# Override or prepend to ensure all required ports are covered
bind_list = [f"0.0.0.0:{port}", "0.0.0.0:8000", "0.0.0.0:10000"]
# Deduplicate while preserving order
bind = list(dict.fromkeys(bind_list))

os.environ["GUNICORN_CMD_ARGS"] = " ".join([f"--bind={b}" for b in bind])

workers = int(os.environ.get("WEB_CONCURRENCY", "1"))
threads = int(os.environ.get("PYTHON_THREADS", "2"))
timeout = 120
accesslog = "-"
errorlog = "-"

def on_starting(server):
    """
    Called by Gunicorn Arbiter setup just before creating sockets.
    Forces listeners to be opened on all necessary ports ($PORT, 8000, 10000)
    regardless of any CLI arguments injected by Render.
    """
    p = os.environ.get("PORT", "8000")
    b_list = list(dict.fromkeys([f"0.0.0.0:{p}", "0.0.0.0:8000", "0.0.0.0:10000"]))
    server.app.cfg.set("bind", b_list)
