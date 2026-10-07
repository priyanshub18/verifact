"""SSRF protection: only public http(s) hosts; every redirect hop is re-validated."""
import asyncio
import ipaddress
import socket
from urllib.parse import urlparse


class UnsafeURL(ValueError):
    pass


def _is_public(ip: str) -> bool:
    a = ipaddress.ip_address(ip)
    return a.is_global and not a.is_multicast


async def assert_public_url(url: str) -> None:
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        raise UnsafeURL("Only http/https URLs are allowed.")
    if not p.hostname:
        raise UnsafeURL("URL has no host.")
    if p.port and p.port not in (80, 443, 8080, 8443):
        raise UnsafeURL("Non-standard port blocked.")
    if p.username or p.password:
        raise UnsafeURL("Credentials in URL are not allowed.")
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(p.hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise UnsafeURL(f"Cannot resolve host: {p.hostname}") from e
    for info in infos:
        if not _is_public(info[4][0]):
            raise UnsafeURL("URL resolves to a non-public address.")
