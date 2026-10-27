package com.qiuzhaohub.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtUtil jwtUtil;

    public JwtAuthFilter(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        // ===== 临时放开鉴权（秋招通本地自用阶段）：直接放行，不校验 token =====
        // 原鉴权逻辑保留为注释，便于后续恢复：
        // String path = request.getServletPath();
        // // 放行认证相关接口
        // if (path.startsWith("/auth/") || path.equals("/error")) {
        //     filterChain.doFilter(request, response);
        //     return;
        // }
        //
        // final String authHeader = request.getHeader("Authorization");
        // String username = null;
        // String token = null;
        //
        // if (authHeader != null && authHeader.startsWith("Bearer ")) {
        //     token = authHeader.substring(7);
        //     try {
        //         username = jwtUtil.extractUsername(token);
        //     } catch (Exception ignored) {
        //     }
        // }
        //
        // if (username != null && SecurityContextHolder.getContext().getAuthentication() == null) {
        //     if (jwtUtil.validate(token)) {
        //         User userDetails = new User(username, "", List.of());
        //         UsernamePasswordAuthenticationToken auth =
        //                 new UsernamePasswordAuthenticationToken(userDetails, null, userDetails.getAuthorities());
        //         auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
        //         SecurityContextHolder.getContext().setAuthentication(auth);
        //     }
        // }
        filterChain.doFilter(request, response);
    }
}
