import React from 'react'
import { motion } from 'framer-motion'

export const animacionPagina = { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -12 }, transition: { duration: 0.25 } }

export function Tarjeta({ children, className = '' }) {
  return <motion.section {...animacionPagina} className={`card ${className}`}>{children}</motion.section>
}

export function IconBox({ children }) {
  return <motion.div className="icon-box" whileHover={{ scale: 1.05, rotate: 1 }}>{children}</motion.div>
}

export function Estado({ children, tipo = '' }) {
  return <em className={`pill ${tipo}`}>{children}</em>
}

export function Campo({ label, children }) {
  return <label className="campo"><span>{label}</span>{children}</label>
}
