/**
 * Complyo brand-tailored Tailwind configuration for reuse across surfaces.
 */
const brandConfig = {
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        complyo: {
          blue: '#2563EB',
          blueDark: '#3B82F6',
          green: '#22C55E',
          slate: '#0F172A',
          bg: '#F8FAFC',
          amber: '#F59E0B',
          red: '#EF4444'
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui']
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem'
      },
      boxShadow: {
        soft: '0 1px 3px rgba(0, 0, 0, 0.1)'
      }
    }
  }
};

export default brandConfig;
