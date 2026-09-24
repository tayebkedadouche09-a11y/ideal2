import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, CardContent, Divider, ListItemButton, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api';

type Channel={id:string;name:string;kind:string;project_id?:string|null;message_count:number};
type Message={id:string;body:string;sender_name:string;created_at:string};

export default function Chat(){
 const [channels,setChannels]=useState<Channel[]>([]);const [active,setActive]=useState<Channel|null>(null);const [messages,setMessages]=useState<Message[]>([]);const [body,setBody]=useState('');const [error,setError]=useState<string|null>(null);
 const load=useCallback(async()=>{try{const r=await api<{channels:Channel[]}>('/chat/channels');setChannels(r.channels);if(!active&&r.channels[0])setActive(r.channels[0]);}catch(e){setError(e instanceof Error?e.message:'Erreur');}},[active]);
 const loadMessages=useCallback(async()=>{if(!active)return;try{setMessages((await api<{messages:Message[]}>('/chat/channels/'+active.id+'/messages')).messages);}catch(e){setError(e instanceof Error?e.message:'Erreur');}},[active]);
 useEffect(()=>{void load();},[load]);useEffect(()=>{void loadMessages();},[loadMessages]);
 async function send(){if(!active||!body.trim())return;try{await api('/chat/channels/'+active.id+'/messages',{method:'POST',body:JSON.stringify({body})});setBody('');await loadMessages();}catch(e){setError(e instanceof Error?e.message:'Erreur');}}
 return <Stack direction={{xs:'column',md:'row'}} spacing={2} sx={{height:'calc(100vh - 120px)'}}>
  <Card sx={{width:{xs:'100%',md:300},overflow:'auto'}}><CardContent><Typography variant="h6">Company Chat</Typography>{channels.map(c=><ListItemButton key={c.id} selected={active?.id===c.id} onClick={()=>setActive(c)}><Stack><Typography>{c.name}</Typography><Typography variant="caption">{c.kind} · {c.message_count} messages</Typography></Stack></ListItemButton>)}</Card>
  <Card sx={{flex:1,display:'flex',flexDirection:'column'}}><CardContent sx={{flex:1,overflow:'auto'}}>{error&&<Alert severity="error" sx={{mb:1}}>{error}</Alert>}{messages.map(m=><Stack key={m.id} sx={{mb:1}}><Typography variant="caption">{m.sender_name} · {new Date(m.created_at).toLocaleString()}</Typography><Typography>{m.body}</Typography></Stack>)}{!messages.length&&<Typography color="text.secondary">Aucun message.</Typography>}</CardContent><Divider/><CardContent><Stack direction="row" spacing={1}><TextField fullWidth size="small" placeholder="Écrire un message..." value={body} onChange={e=>setBody(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send();}}}/><Button variant="contained" onClick={()=>void send()} disabled={!body.trim()||!active}>Envoyer</Button></Stack></CardContent></Card>
 </Stack>;
}
