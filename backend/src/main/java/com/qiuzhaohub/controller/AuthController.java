package com.qiuzhaohub.controller;

import com.qiuzhaohub.controller.dto.AuthDto;
import com.qiuzhaohub.service.AuthService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    // ===== 临时移除登录功能（秋招通本地自用阶段）=====
    // 登录 / 获取当前用户 接口全部停用，代码保留便于后续恢复鉴权时启用。
    // 前端已不再调用，SecurityConfig 也已 permitAll。
    // @PostMapping("/login")
    // public ResponseEntity<?> login(@RequestBody AuthDto.LoginRequest req) {
    //     String token = authService.login(req);
    //     return ResponseEntity.ok(new AuthDto.LoginResponse(token, req.getUsername()));
    // }
    //
    // @GetMapping("/me")
    // public ResponseEntity<?> me(@RequestHeader("Authorization") String auth) {
    //     String username = auth.replace("Bearer ", "");
    //     return ResponseEntity.ok(Map.of("username", username));
    // }
}
