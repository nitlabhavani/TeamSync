"""Uniform JSON envelopes shared by every endpoint."""
from flask import jsonify


def ok(data, message: str = ""):
    return jsonify({"success": True, "message": message, "data": data})


def fail(message: str, status: int = 400):
    return jsonify({"success": False, "message": message, "data": None}), status
