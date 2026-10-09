import {Component,type ReactNode} from 'react';
export class AppErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){void window.fox.data.rendererError('RENDERER_FAILURE').catch(()=>{});}
  render(){if(this.state.failed)return <main className="settings-panel" role="alert"><h1>FOX nuk mund ta shfaqë këtë ekran.</h1><p>Të dhënat e ruajtura nuk janë fshirë. Rihap aplikacionin për të vazhduar.</p><button onClick={()=>window.location.reload()}>Rihap ekranin</button></main>;return this.props.children;}
}
