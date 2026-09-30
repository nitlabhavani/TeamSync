import os

# Automatically bind to 0.0.0.0 and the PORT provided in the environment (defaults to 8000 or 10000)
port = os.environ.get("PORT", "8000")
bind = f"0.0.0.0:{port}"
workers = int(os.environ.get("WEB_CONCURRENCY", "1"))
threads = int(os.environ.get("PYTHON_THREADS", "2"))
timeout = 120
accesslog = "-"
errorlog = "-"
