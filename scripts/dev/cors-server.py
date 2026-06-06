#!/usr/bin/env python3
"""Tiny static server with CORS headers, for IG drafts upload via JS."""
import http.server, socketserver, os

PORT = 5180
os.chdir(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

class CORSHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET')
        super().end_headers()

with socketserver.TCPServer(('', PORT), CORSHandler) as httpd:
    print(f'serving on :{PORT}')
    httpd.serve_forever()
