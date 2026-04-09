package response

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Code represents an API response code
type Code int

const (
	CodeSuccess          Code = 0
	CodeBadRequest       Code = 400
	CodeUnauthorized     Code = 401
	CodeForbidden        Code = 403
	CodeNotFound         Code = 404
	CodeConflict         Code = 409
	CodeInternalError    Code = 500
	CodeServiceUnavailable Code = 503
)

// Response is the standard API response structure
type Response struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// PaginatedResponse includes pagination metadata
type PaginatedResponse struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
	Page    int         `json:"page"`
	PerPage int         `json:"per_page"`
	Total   int64       `json:"total"`
	HasMore bool        `json:"has_more"`
}

// Success sends a successful response
func Success(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Response{
		Code:    int(CodeSuccess),
		Message: "success",
		Data:    data,
	})
}

// SuccessWithMessage sends a successful response with a custom message
func SuccessWithMessage(c *gin.Context, message string, data interface{}) {
	c.JSON(http.StatusOK, Response{
		Code:    int(CodeSuccess),
		Message: message,
		Data:    data,
	})
}

// Created sends a 201 Created response
func Created(c *gin.Context, data interface{}) {
	c.JSON(http.StatusCreated, Response{
		Code:    int(CodeSuccess),
		Message: "created",
		Data:    data,
	})
}

// Paginated sends a paginated response
func Paginated(c *gin.Context, data interface{}, page, perPage int, total int64) {
	hasMore := int64(page*perPage) < total
	c.JSON(http.StatusOK, PaginatedResponse{
		Code:    int(CodeSuccess),
		Message: "success",
		Data:    data,
		Page:    page,
		PerPage: perPage,
		Total:   total,
		HasMore: hasMore,
	})
}

// Error sends an error response
func Error(c *gin.Context, httpStatus int, code Code, message string) {
	c.JSON(httpStatus, Response{
		Code:    int(code),
		Message: message,
	})
}

// BadRequest sends a 400 error response
func BadRequest(c *gin.Context, message string) {
	Error(c, http.StatusBadRequest, CodeBadRequest, message)
}

// Unauthorized sends a 401 error response
func Unauthorized(c *gin.Context, message string) {
	Error(c, http.StatusUnauthorized, CodeUnauthorized, message)
}

// Forbidden sends a 403 error response
func Forbidden(c *gin.Context, message string) {
	Error(c, http.StatusForbidden, CodeForbidden, message)
}

// NotFound sends a 404 error response
func NotFound(c *gin.Context, message string) {
	Error(c, http.StatusNotFound, CodeNotFound, message)
}

// Conflict sends a 409 error response
func Conflict(c *gin.Context, message string) {
	Error(c, http.StatusConflict, CodeConflict, message)
}

// InternalError sends a 500 error response
func InternalError(c *gin.Context, message string) {
	Error(c, http.StatusInternalServerError, CodeInternalError, message)
}
