import { theme } from 'antd';
import type { ThemeConfig } from 'antd';

/*
 * admin 像素暗色主题: antd darkAlgorithm + Sweetie-16 映射(与 ui/theme.css 同源)。
 * 像素三板斧的 antd 对应物: 零圆角(borderRadius 0)、slate 描边(colorBorder)、
 * 硬阴影(admin.css 给 primary 按钮补 0 3px 0 按压感)。
 * #232741/#151726 为 --px-ink 的明度阶梯中间档(非 Sweetie-16 原生色)。
 */
export const ADMIN_THEME: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorBgBase: '#1a1c2c',
    colorBgLayout: '#1a1c2c',
    colorBgContainer: '#232741',
    colorBgElevated: '#333c57',
    colorBgSpotlight: '#333c57',
    colorPrimary: '#ffcd75',
    colorTextLightSolid: '#1a1c2c',
    colorText: '#f4f4f4',
    colorTextSecondary: '#94b0c2',
    colorTextTertiary: '#566c86',
    colorBorder: '#566c86',
    colorBorderSecondary: '#3a4664',
    colorSuccess: '#38b764',
    colorError: '#b13e53',
    colorWarning: '#ef7d57',
    colorInfo: '#41a6f6',
    colorLink: '#41a6f6',
    borderRadius: 0,
    borderRadiusLG: 0,
    borderRadiusSM: 0,
    fontFamily: 'var(--px-font-ui)',
    fontSize: 13,
    controlHeight: 30,
  },
  components: {
    Layout: {
      siderBg: '#151726',
      headerBg: '#232741',
      headerHeight: 48,
      headerPadding: '0 20px',
      bodyBg: '#1a1c2c',
    },
    Menu: {
      itemBg: 'transparent',
      itemColor: '#94b0c2',
      itemHoverColor: '#f4f4f4',
      itemHoverBg: 'rgba(41, 54, 111, 0.35)',
      itemSelectedBg: '#29366f',
      itemSelectedColor: '#ffcd75',
      groupTitleColor: '#566c86',
      activeBarBorderWidth: 0,
      popupBg: '#333c57',
    },
    Table: {
      headerBg: '#29366f',
      headerColor: '#f4f4f4',
      headerSplitColor: 'transparent',
      rowHoverBg: 'rgba(41, 54, 111, 0.5)',
      borderColor: '#3a4664',
      cellPaddingBlock: 8,
      cellPaddingInline: 12,
    },
    Card: {
      headerBg: 'transparent',
    },
    Button: {
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
    },
    Modal: {
      contentBg: '#333c57',
      headerBg: '#333c57',
    },
    Segmented: {
      trackBg: '#1a1c2c',
      itemSelectedBg: '#29366f',
    },
    Tree: {
      nodeSelectedBg: '#29366f',
      nodeHoverBg: 'rgba(41, 54, 111, 0.35)',
    },
  },
};
