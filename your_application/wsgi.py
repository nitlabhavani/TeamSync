import os
import sys

ai_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ai-engine")
if ai_dir not in sys.path:
    sys.path.insert(0, ai_dir)

from app import app

application = app
