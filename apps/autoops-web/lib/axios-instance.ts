import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';

// API 基础 URL - 使用相对路径，通过 Next.js 代理转发到后端
const API_BASE_URL = '/api/v1';

// 创建 axios 实例
export const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10秒超时
});

// 响应拦截器 - 统一错误处理
axiosInstance.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // 登录态失效，跳转到登录页
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Orval 使用的自定义实例
export const customInstance = <T>(
  config: AxiosRequestConfig
): Promise<AxiosResponse<T>> => {
  return axiosInstance.request<T>(config);
};

export default axiosInstance;
