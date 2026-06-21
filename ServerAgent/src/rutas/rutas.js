import { Home, Code2, FolderOpen, Server, ShieldCheck, RadioTower } from 'lucide-react'
import { Inicio } from '../paginas/Inicio.jsx'
import { TestApis } from '../paginas/TestApis.jsx'
import { FileExplorer } from '../paginas/FileExplorer.jsx'
import { Servidor } from '../paginas/Servidor.jsx'
import { ServiciosAdmin } from '../paginas/ServiciosAdmin.jsx'
import { Runners } from '../paginas/Runners.jsx'

export const rutasPrivadas = [
  { path: '/', id: 'home', icon: Home, componente: Inicio },
  { path: '/test-apis', id: 'test', icon: Code2, componente: TestApis },
  { path: '/runners', id: 'runners', icon: RadioTower, componente: Runners },
  { path: '/file-explorer', id: 'explorer', icon: FolderOpen, componente: FileExplorer },
  { path: '/servidor', id: 'server', icon: Server, componente: Servidor },
  { path: '/servicios-admin', id: 'services', icon: ShieldCheck, componente: ServiciosAdmin }
]

export function rutaActual(pathname) {
  return rutasPrivadas.find((r) => r.path === pathname) || rutasPrivadas[0]
}
