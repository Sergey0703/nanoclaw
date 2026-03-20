#!/usr/bin/env python3
"""Simple MCP server for YouTube transcripts via Tor proxy"""
import sys, json
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig

PROXY = GenericProxyConfig(
    https_url='socks5://172.17.0.1:9050',
)

def get_transcript(video_id, lang='en'):
    ytt = YouTubeTranscriptApi(proxy_config=PROXY)
    try:
        transcript = ytt.fetch(video_id, languages=[lang, 'en'])
    except Exception:
        transcript = ytt.fetch(video_id)
    return ' '.join(s.text for s in transcript)

def handle(req):
    method = req.get('method')
    req_id = req.get('id')
    if method == 'initialize':
        return {'jsonrpc':'2.0','id':req_id,'result':{'protocolVersion':'2024-11-05','capabilities':{'tools':{}},'serverInfo':{'name':'yt-transcript','version':'1.0'}}}
    if method == 'tools/list':
        return {'jsonrpc':'2.0','id':req_id,'result':{'tools':[{'name':'get_transcripts','description':'Get YouTube video transcript','inputSchema':{'type':'object','properties':{'url':{'type':'string','description':'YouTube URL or video ID'},'lang':{'type':'string','description':'Language code, default en'}},'required':['url']}}]}}
    if method == 'tools/call':
        args = req.get('params',{}).get('arguments',{})
        url = args.get('url','')
        lang = args.get('lang','en')
        # Extract video ID
        vid = url
        if 'v=' in url: vid = url.split('v=')[1].split('&')[0]
        elif 'youtu.be/' in url: vid = url.split('youtu.be/')[1].split('?')[0]
        try:
            text = get_transcript(vid, lang)
            return {'jsonrpc':'2.0','id':req_id,'result':{'content':[{'type':'text','text':text}]}}
        except Exception as e:
            return {'jsonrpc':'2.0','id':req_id,'result':{'content':[{'type':'text','text':f'Error: {e}'}],'isError':True}}
    return {'jsonrpc':'2.0','id':req_id,'error':{'code':-32601,'message':'Method not found'}}

for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        req = json.loads(line)
        resp = handle(req)
        print(json.dumps(resp), flush=True)
    except Exception as e:
        print(json.dumps({'jsonrpc':'2.0','id':None,'error':{'code':-32700,'message':str(e)}}), flush=True)
