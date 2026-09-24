import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { fetchApprovals, decideApproval, createApproval, getAuth, type ApprovalRequest } from '../api';

export default function ApprovalCenter(){
 const role=getAuth()?.user.roles[0]??'worker'; const canCreate=role==='owner'||role==='storekeeper';
 const [rows,setRows]=useState<ApprovalRequest[]>([]);const [error,setError]=useState<string|null>(null);const [open,setOpen]=useState(false);
 const [form,setForm]=useState({action:'',reason:'',risk:'medium',amount:''});
 const load=useCallback(async()=>{try{setRows((await fetchApprovals()).approvals);}catch(e){setError(e instanceof Error?e.message:'Erreur');}},[]);
 useEffect(()=>{void load();},[load]);
 async function decide(id:string,d:'approved'|'rejected'){try{await decideApproval(id,d);await load();}catch(e){setError(e instanceof Error?e.message:'Erreur');}}
 async function save(){try{await createApproval({action:form.action,reason:form.reason,risk:form.risk,amount:form.amount?Number(form.amount):undefined});setOpen(false);setForm({action:'',reason:'',risk:'medium',amount:''});await load();}catch(e){setError(e instanceof Error?e.message:'Erreur');}}
 return <Card><CardContent>
  <Stack direction="row" justifyContent="space-between" sx={{mb:2}}><div><Typography variant="h6">Approval Center</Typography><Typography color="text.secondary">Décisions humaines explicites avant les actions à risque.</Typography></div>{canCreate&&<Button variant="contained" onClick={()=>setOpen(true)}>+ Demande</Button>}</Stack>
  {error&&<Alert severity="error" sx={{mb:2}}>{error}</Alert>}
  {rows.map(r=><Card variant="outlined" sx={{mb:1}} key={r.id}><CardContent>
   <Stack direction="row" spacing={1} alignItems="center"><Typography sx={{flexGrow:1}}><b>{r.action}</b></Typography><Chip size="small" label={r.status}/><Chip size="small" label={r.risk}/></Stack>
   <Typography>{r.reason}</Typography>
   {r.amount!=null&&<Typography color="text.secondary">Montant: {Number(r.amount).toLocaleString('fr-DZ')} DA</Typography>}
   <Typography variant="caption" color="text.secondary">Demandé par {r.requested_by_name??'—'} • {new Date(r.created_at).toLocaleString()}</Typography>
   {r.status==='pending'&&<Stack direction="row" spacing={1} sx={{mt:1}}><Button color="success" variant="contained" size="small" onClick={()=>void decide(r.id,'approved')}>Approuver</Button><Button color="error" variant="outlined" size="small" onClick={()=>void decide(r.id,'rejected')}>Refuser</Button></Stack>}
  </CardContent></Card>)}
  {rows.length===0&&<Typography color="text.secondary">Aucune demande.</Typography>}
  <Dialog open={open} onClose={()=>setOpen(false)} fullWidth maxWidth="sm"><DialogTitle>Nouvelle demande d’approbation</DialogTitle><DialogContent>
   <TextField fullWidth label="Action" margin="dense" value={form.action} onChange={e=>setForm({...form,action:e.target.value})}/>
   <TextField select fullWidth label="Risque" margin="dense" value={form.risk} onChange={e=>setForm({...form,risk:e.target.value})} SelectProps={{native:true}}><option value="low">Faible</option><option value="medium">Moyen</option><option value="high">Élevé</option><option value="critical">Critique</option></TextField>
   <TextField fullWidth type="number" label="Montant DA (optionnel)" margin="dense" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/>
   <TextField fullWidth multiline minRows={3} label="Motif" margin="dense" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/>
  </DialogContent><DialogActions><Button onClick={()=>setOpen(false)}>Annuler</Button><Button variant="contained" onClick={()=>void save()} disabled={!form.action||!form.reason}>Créer</Button></DialogActions></Dialog>
 </CardContent></Card>;
}
