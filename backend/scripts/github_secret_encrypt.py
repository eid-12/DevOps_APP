#!/usr/bin/env python3
"""Encrypt a GitHub Actions secret with libsodium sealed box (PyNaCl)."""
import base64
import sys

from nacl import encoding, public


def encrypt(public_key_b64: str, secret_value: str) -> str:
    public_key = public.PublicKey(public_key_b64.encode("utf-8"), encoding.Base64Encoder())
    sealed_box = public.SealedBox(public_key)
    encrypted = sealed_box.encrypt(secret_value.encode("utf-8"))
    return base64.b64encode(encrypted).decode("utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: github_secret_encrypt.py <public_key_b64> <secret_value>", file=sys.stderr)
        sys.exit(2)
    print(encrypt(sys.argv[1], sys.argv[2]), end="")
