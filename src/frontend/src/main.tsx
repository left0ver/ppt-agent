import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <ConfigProvider
    locale={zhCN}
    theme={{
      token: {
        borderRadius: 18,
        colorPrimary: '#b6653d',
        colorInfo: '#b6653d',
        colorText: '#34271f',
        colorTextSecondary: '#7d6756',
        fontFamily:
          '"Source Han Serif SC", "Noto Serif SC", "Songti SC", serif',
        fontSize: 15,
      },
    }}
  >
    <AntdApp>
      <App />
    </AntdApp>
  </ConfigProvider>,
)
