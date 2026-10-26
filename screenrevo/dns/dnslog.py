#!/usr/bin/env python3
"""A small DNS server for this computer that shows what the TV looks up, and can block domains from a list.

    python3 screenrevo/dns/dnslog.py --log-only                    # only watch: every lookup is answered as usual
    python3 screenrevo/dns/dnslog.py                               # block screenrevo/dns/samsung-blocklist.txt
    python3 screenrevo/dns/dnslog.py --upstream 192.168.1.1 --port 53 --out logs --block other.txt

Point the TV's DNS at this computer for a test (TV: Settings, General, Network, Network Status, IP Settings, DNS
manual), use it as usual, and each lookup prints here and lands in logs/dns-<date>.jsonl. Put the TV's DNS back
when done: with this computer off, the TV can't look anything up. Blocked names get 0.0.0.0 (::), as Pi-hole does;
never-block.txt always wins. Answers only private (LAN) addresses, so it can't serve as an open resolver. UDP only:
TVs ask over UDP, and an answer too big for it would need TCP (it doesn't happen for these names).
"""
import collections
import datetime
import ipaddress
import json
import os
import socket
import struct
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
TYPES = {1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 65: 'HTTPS'}


def load(path):
    """The domains in a list file (one per line, # comments), lowercased."""
    out = set()
    with open(path, encoding='utf-8') as f:
        for line in f:
            name = line.split('#', 1)[0].strip().lower().rstrip('.')
            if name:
                out.add(name)
    return out


def listed(name, domains):
    """Whether name is one of the domains or under one of them."""
    parts = name.split('.')
    return any('.'.join(parts[i:]) in domains for i in range(len(parts)))


def question(packet):
    """(name, qtype, end of the question) from a DNS query, or None if it isn't one."""
    if len(packet) < 12 or struct.unpack('>H', packet[4:6])[0] < 1:
        return None
    labels, i = [], 12
    while i < len(packet):
        n = packet[i]
        if n == 0:
            break
        if n & 0xC0 or i + 1 + n > len(packet):
            return None   # queries don't compress their name
        labels.append(packet[i + 1:i + 1 + n].decode('ascii', 'replace'))
        i += 1 + n
    if i + 5 > len(packet):
        return None
    qtype = struct.unpack('>H', packet[i + 1:i + 3])[0]
    return '.'.join(labels).lower(), qtype, i + 5


def blocked_answer(packet, qtype, end):
    """An answer saying 0.0.0.0 (A), :: (AAAA) or nothing (other types) for the query in packet."""
    flags = 0x8180 | (struct.unpack('>H', packet[2:4])[0] & 0x0100)   # response, recursion available, RD as asked
    data = {1: b'\0' * 4, 28: b'\0' * 16}.get(qtype)
    head = packet[:2] + struct.pack('>HHHHH', flags, 1, 1 if data else 0, 0, 0)
    body = packet[12:end]
    if data:
        body += struct.pack('>HHHIH', 0xC00C, qtype, 1, 60, len(data)) + data
    return head + body


class Server:
    def __init__(self, args):
        self.upstream = (args.get('upstream', '1.1.1.1'), 53)
        self.block = set() if 'log-only' in args else load(args.get('block', os.path.join(HERE, 'samsung-blocklist.txt')))
        self.keep = load(os.path.join(HERE, 'never-block.txt'))
        self.out = os.path.abspath(args.get('out', 'logs'))
        self.counts = collections.Counter()
        self.lock = threading.Lock()
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind((args.get('host', '0.0.0.0'), int(args.get('port', '53'))))
        self.sock.settimeout(1)   # so Ctrl+C gets through on Windows

    def log(self, client, name, qtype, verdict):
        now = datetime.datetime.now()
        entry = {'t': now.isoformat(timespec='seconds'), 'client': client, 'name': name,
                 'type': TYPES.get(qtype, str(qtype)), 'verdict': verdict}
        with self.lock:
            self.counts[(name, verdict)] += 1
            os.makedirs(self.out, exist_ok=True)
            with open(os.path.join(self.out, 'dns-%s.jsonl' % now.strftime('%Y%m%d')), 'a', encoding='utf-8') as f:
                f.write(json.dumps(entry) + '\n')
        print('%s  %-15s %-5s %-7s %s' % (entry['t'][11:], client, entry['type'], verdict, name), flush=True)

    def answer(self, packet, client):
        q = question(packet)
        if not q:
            return
        name, qtype, end = q
        if self.block and listed(name, self.block) and not listed(name, self.keep):
            self.sock.sendto(blocked_answer(packet, qtype, end), client)
            self.log(client[0], name, qtype, 'BLOCKED')
            return
        up = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        up.settimeout(4)
        try:
            up.sendto(packet, self.upstream)
            reply, _ = up.recvfrom(65535)
            self.sock.sendto(reply, client)
            self.log(client[0], name, qtype, 'ok')
        except OSError:
            self.log(client[0], name, qtype, 'timeout')
        finally:
            up.close()

    def serve(self):
        while True:
            try:
                packet, client = self.sock.recvfrom(4096)
            except socket.timeout:
                continue
            except ConnectionResetError:
                continue   # Windows reports an earlier reply's ICMP "unreachable" here
            if not ipaddress.ip_address(client[0]).is_private:
                continue
            threading.Thread(target=self.answer, args=(packet, client), daemon=True).start()

    def summary(self):
        print('\nLookups, most asked first:')
        for (name, verdict), n in self.counts.most_common(60):
            print('  %5d  %-7s %s' % (n, verdict, name))


def main():
    args, argv = {}, sys.argv[1:]
    for i, a in enumerate(argv):
        if a.startswith('--'):
            nxt = argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith('--') else ''
            args[a[2:]] = nxt
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(errors='replace')
    try:
        server = Server(args)
    except OSError as e:
        sys.exit('Couldn\'t listen on port %s (%s): something else on this computer may be using it.'
                 % (args.get('port', '53'), e))
    print('ScreenRevo DNS on %s:%s, asking %s; %s; log in %s (Ctrl+C stops it and lists what was asked)'
          % (args.get('host', '0.0.0.0'), args.get('port', '53'), server.upstream[0],
             'only watching' if not server.block else 'blocking %d domains' % len(server.block), server.out), flush=True)
    try:
        server.serve()
    except KeyboardInterrupt:
        server.summary()


if __name__ == '__main__':
    main()
