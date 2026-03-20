#!/usr/bin/env python3
"""MCP server for YouTube transcripts via yt-dlp with cookies"""
import sys
import json
import re
import subprocess
import tempfile
import os

COOKIES_FILE = '/opt/nanoclaw/youtube_cookies.txt'

def clean_vtt(content):
    """Extract plain text from VTT subtitle file, removing timestamps and tags."""
    lines = content.split('\n')
    text_lines = []
    for line in lines:
        line = line.strip()
        # Skip header, timestamps, blank lines, cue numbers
        if not line:
            continue
        if line.startswith('WEBVTT') or line.startswith('Kind:') or line.startswith('Language:'):
            continue
        if '-->' in line:
            continue
        if re.match(r'^\d+$', line):
            continue
        # Remove inline VTT timing tags like <00:00:01.400><c> and </c>
        line = re.sub(r'<[^>]+>', '', line)
        line = line.strip()
        if line:
            text_lines.append(line)

    # Deduplicate consecutive identical lines (VTT often repeats)
    deduped = []
    for line in text_lines:
        if not deduped or deduped[-1] != line:
            deduped.append(line)

    return ' '.join(deduped)


def get_transcript(video_id, lang='ru'):
    """Download transcript using yt-dlp and return clean text."""
    url = f'https://www.youtube.com/watch?v={video_id}'

    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, 'sub')

        cmd = [
            'yt-dlp',
            '--cookies', COOKIES_FILE,
            '--js-runtimes', 'node',
            '--remote-components', 'ejs:github',
            '--write-auto-sub',
            '--sub-lang', f'{lang},ru,en',
            '--skip-download',
            '--no-playlist',
            '--quiet',
            url,
            '-o', output_path,
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)

        # Find downloaded .vtt file
        for fname in os.listdir(tmpdir):
            if fname.endswith('.vtt'):
                fpath = os.path.join(tmpdir, fname)
                with open(fpath, encoding='utf-8') as f:
                    content = f.read()
                return clean_vtt(content)

        # No VTT found — return stderr for debugging
        stderr = result.stderr.strip()
        raise Exception(f'No transcript downloaded. yt-dlp: {stderr[-500:] if stderr else "no output"}')


def handle(req):
    method = req.get('method')
    req_id = req.get('id')
    if method == 'initialize':
        return {'jsonrpc': '2.0', 'id': req_id, 'result': {
            'protocolVersion': '2024-11-05',
            'capabilities': {'tools': {}},
            'serverInfo': {'name': 'yt-transcript', 'version': '2.0'}
        }}
    if method == 'tools/list':
        return {'jsonrpc': '2.0', 'id': req_id, 'result': {'tools': [{
            'name': 'get_transcripts',
            'description': 'Get YouTube video transcript as plain text',
            'inputSchema': {
                'type': 'object',
                'properties': {
                    'url': {'type': 'string', 'description': 'YouTube URL or video ID'},
                    'lang': {'type': 'string', 'description': 'Language code (default: ru)'}
                },
                'required': ['url']
            }
        }]}}
    if method == 'tools/call':
        args = req.get('params', {}).get('arguments', {})
        url = args.get('url', '')
        lang = args.get('lang', 'ru')
        # Extract video ID
        vid = url
        if 'v=' in url:
            vid = url.split('v=')[1].split('&')[0]
        elif 'youtu.be/' in url:
            vid = url.split('youtu.be/')[1].split('?')[0]
        try:
            text = get_transcript(vid, lang)
            return {'jsonrpc': '2.0', 'id': req_id, 'result': {
                'content': [{'type': 'text', 'text': text}]
            }}
        except Exception as e:
            return {'jsonrpc': '2.0', 'id': req_id, 'result': {
                'content': [{'type': 'text', 'text': f'Error: {e}'}],
                'isError': True
            }}
    return {'jsonrpc': '2.0', 'id': req_id, 'error': {'code': -32601, 'message': 'Method not found'}}


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        resp = handle(req)
        print(json.dumps(resp), flush=True)
    except Exception as e:
        print(json.dumps({'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': str(e)}}), flush=True)
